"""Command line interface."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import MODEL_PATH, REPORTS_DIR
from .data import build_dataset, dataset_stats, load_dataset
from .model import (
    evaluate_artifact,
    load_artifact,
    run_source_experiments,
    save_report,
    train_model,
)
from .scanner import Scanner


def _print_metrics(name: str, report: dict) -> None:
    overall = report.get("overall") or {}
    print(f"\n{name}")
    print(
        "  overall  "
        f"F1={overall.get('f1')}  precision={overall.get('precision')}  "
        f"recall={overall.get('recall')}  AUC={overall.get('roc_auc')}  "
        f"FPR={overall.get('false_positive_rate')}"
    )
    for source, metrics in report.get("by_source", {}).items():
        print(
            f"  {source:<9} "
            f"F1={metrics.get('f1')}  precision={metrics.get('precision')}  "
            f"recall={metrics.get('recall')}  AUC={metrics.get('roc_auc')}  "
            f"FPR={metrics.get('false_positive_rate')}  n={sum(metrics['confusion'].values())}"
        )


def cmd_build_data(args: argparse.Namespace) -> int:
    df = build_dataset(force=args.force)
    print(json.dumps(dataset_stats(), indent=2))
    print(f"\nwrote {len(df)} rows")
    return 0


def cmd_train(args: argparse.Namespace) -> int:
    df = load_dataset()
    sources = args.sources or None
    artifact = train_model(df, train_sources=sources, path=MODEL_PATH)
    report = evaluate_artifact(artifact, df)
    _print_metrics("held-out test", report)
    save_report(
        {
            "metadata": artifact["metadata"],
            "threshold": artifact["threshold"],
            "test": report,
        },
        REPORTS_DIR / "metrics.json",
    )
    return 0


def cmd_evaluate(args: argparse.Namespace) -> int:
    df = load_dataset()
    artifact = load_artifact()
    report = evaluate_artifact(artifact, df, split=args.split)
    _print_metrics(f"artifact on {args.split}", report)
    if args.experiments:
        experiments = run_source_experiments(df)
        print("\n=== cross-source experiments ===")
        for name, result in experiments.items():
            _print_metrics(name, result)
        save_report(experiments, REPORTS_DIR / "experiments.json")
        print(f"\nwrote {REPORTS_DIR / 'experiments.json'}")
    return 0


def cmd_scan(args: argparse.Namespace) -> int:
    if args.file:
        text = Path(args.file).read_text(encoding="utf-8", errors="replace")
    elif args.text:
        text = args.text
    elif not sys.stdin.isatty():
        text = sys.stdin.read()
    else:
        print("provide --text, --file, or pipe a message on stdin", file=sys.stderr)
        return 2

    result = Scanner().analyze(text)
    if args.json:
        print(json.dumps(result, indent=2))
        return 0

    print(f"\nverdict: {result['verdict'].upper()}   risk: {result['risk_score']}/100")
    model = result["model"]
    print(
        f"model: {model['probability'] if model['available'] else 'not loaded'}"
        f"   rules: {result['rules']['score']}"
    )
    print("\nreasons:")
    for reason in result["reasons"]:
        print(f"  [{reason['strength']:>3}] {reason['label']} — {reason['detail']}")
    if result["urls"]:
        print("\nlinks (not opened):")
        for url in result["urls"]:
            flags = ", ".join(flag["code"] for flag in url["flags"]) or "no structural flags"
            print(f"  {url['defanged']}  risk={url['risk']}  {flags}")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("phishingan.api:app", host=args.host, port=args.port, reload=args.reload)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="phishingan",
        description="Explainable detection of AI-generated phishing.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("build-data", help="download and prepare the datasets")
    p.add_argument("--force", action="store_true", help="rebuild even if the CSV exists")
    p.set_defaults(func=cmd_build_data)

    p = sub.add_parser("train", help="train and save the model")
    p.add_argument("--sources", nargs="+", choices=["classic", "llm"], help="sources to train on")
    p.set_defaults(func=cmd_train)

    p = sub.add_parser("evaluate", help="evaluate the saved model")
    p.add_argument("--split", default="test", choices=["train", "val", "test"])
    p.add_argument("--experiments", action="store_true", help="run cross-source experiments")
    p.set_defaults(func=cmd_evaluate)

    p = sub.add_parser("scan", help="scan one message")
    p.add_argument("--text")
    p.add_argument("--file")
    p.add_argument("--json", action="store_true", help="print full JSON")
    p.set_defaults(func=cmd_scan)

    p = sub.add_parser("serve", help="start the web UI and API")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--reload", action="store_true")
    p.set_defaults(func=cmd_serve)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
