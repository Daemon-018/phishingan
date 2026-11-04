"""Demo messages shipped with the web UI.

All domains use reserved example-style names, so nothing here is clickable even
if a reader ignores the defanging.
"""

SAMPLES = [
    {
        "id": "ai-credential",
        "title": "AI-written account alert",
        "tag": "LLM-style phishing",
        "text": (
            "Subject: Action Required: Unusual Sign-In Activity\n"
            "From: Security Team <security@account-review.top>\n\n"
            "Dear Valued Customer,\n\n"
            "I hope this email finds you well. As part of our ongoing efforts to "
            "protect your account, we have detected unusual activity that requires "
            "your immediate attention. To avoid suspension, please verify your "
            "identity within 24 hours by reviewing the secure document below.\n\n"
            "https://secure-account-review.top/verify?session=8f3a91c2\n\n"
            "Please do not hesitate to reach out if you have any questions. Thank "
            "you for your cooperation.\n\n"
            "Sincerely,\n"
            "Account Security Team"
        ),
    },
    {
        "id": "classic-ip",
        "title": "Classic urgent suspension",
        "tag": "Traditional phishing",
        "text": (
            "Subject: URGENT!!! YOUR ACCOUNT WILL BE SUSPENDED\n"
            "From: support@bank-alert.example\n\n"
            "DEAR CUSTOMER,\n\n"
            "We detected unauthorized access to your online banking account. Your "
            "account will be locked within 24 hours unless you confirm your "
            "password and card number immediately.\n\n"
            "Click here to restore access: http://192.0.2.44/login/verify\n\n"
            "Failure to comply will result in permanent closure.\n\n"
            "Bank Security Department"
        ),
    },
    {
        "id": "ai-giftcard",
        "title": "AI-written CEO request",
        "tag": "LLM-style fraud",
        "text": (
            "Subject: Quick Favour\n"
            "From: Managing Director <director@company-exec.example>\n\n"
            "Hi,\n\n"
            "I hope you are doing well. I am currently in back-to-back meetings "
            "and need a small favour handled discreetly. We are finalising a "
            "client appreciation event and I need four gift cards purchased today. "
            "Please keep this between us for now and send me the redemption codes "
            "as soon as they are available.\n\n"
            "Kindly confirm you can help at your earliest convenience.\n\n"
            "Thank you for your prompt attention to this matter.\n\n"
            "Best regards,\n"
            "Managing Director"
        ),
    },
    {
        "id": "legit-project",
        "title": "Normal project update",
        "tag": "Legitimate",
        "text": (
            "Subject: Notes from Tuesday's design review\n"
            "From: Priya Raman <priya@studio.example>\n\n"
            "Hi Arjun,\n\n"
            "Thanks for joining the review. I have attached the updated wireframes "
            "for the checkout flow. The main changes are the simplified address "
            "form and the new empty state on the cart page.\n\n"
            "Could you send your comments by Friday? No rush if something comes up.\n\n"
            "Best,\n"
            "Priya"
        ),
    },
    {
        "id": "legit-reset",
        "title": "Real password reset",
        "tag": "Hard negative",
        "text": (
            "Subject: Reset your password\n"
            "From: Acme Workspace <no-reply@acme-workspace.example>\n\n"
            "Hello Arjun,\n\n"
            "We received a request to reset the password for your Acme Workspace "
            "account. If this was you, use the button below to choose a new "
            "password. This link expires in 30 minutes.\n\n"
            "https://accounts.acme-workspace.example/reset/9d2f\n\n"
            "If you did not request this, you can safely ignore this email. Your "
            "password will not change.\n\n"
            "Acme Workspace Security"
        ),
    },
    {
        "id": "legit-newsletter",
        "title": "Newsletter with an offer",
        "tag": "Hard negative",
        "text": (
            "Subject: This week at Frontend Weekly\n"
            "From: Frontend Weekly <hello@frontend-weekly.example>\n\n"
            "Hi there,\n\n"
            "This week we look at accessible form patterns, a gentle introduction "
            "to view transitions, and three small CSS tricks worth stealing. Our "
            "sponsor is offering readers a free trial of their component library "
            "until the end of the month.\n\n"
            "Read the issue: https://frontend-weekly.example/issues/214\n\n"
            "You are receiving this because you subscribed on our website. "
            "Unsubscribe any time."
        ),
    },
]


def get_samples() -> list[dict]:
    return SAMPLES
