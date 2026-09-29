"""HTML email templates for intervention escalation (3-tier).

Provides Mentible-branded HTML emails with mobile responsiveness.
Templates mirror `email_templates.py` structure (5 stall reasons × 3 tiers).
"""

from dataclasses import dataclass

from backend.src.analytics.models import StallReason


@dataclass(frozen=True)
class HtmlEmailTemplate:
    """HTML email with subject + body."""

    subject: str
    html_body: str


# Base HTML structure (shared header/footer)
_MENTIBLE_LOGO = "https://mentible.app/mentible-logo.png"
_SUPPORT_EMAIL = "support@kaundinyalabs.com"
_COLOR_PRIMARY = "#1a1f3a"  # Navy
_COLOR_ACCENT = "#4f46e5"  # Indigo
_COLOR_TEXT = "#374151"  # Slate gray


def _wrap_html(content: str, subject_line: str = "") -> str:
    """Wrap content in responsive HTML email template."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mentible</title>
    <style>
        body {{
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: #f9fafb;
        }}
        .email-container {{
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow: hidden;
        }}
        .header {{
            background-color: {_COLOR_PRIMARY};
            padding: 32px 24px;
            text-align: center;
        }}
        .header h1 {{
            color: #ffffff;
            margin: 0;
            font-size: 28px;
            font-weight: 700;
            letter-spacing: -0.5px;
        }}
        .content {{
            padding: 32px 24px;
            color: {_COLOR_TEXT};
            line-height: 1.6;
        }}
        .content h2 {{
            color: {_COLOR_PRIMARY};
            font-size: 20px;
            margin-top: 0;
            margin-bottom: 12px;
        }}
        .content p {{
            margin: 0 0 16px 0;
            font-size: 15px;
        }}
        .cta-button {{
            display: inline-block;
            background-color: {_COLOR_ACCENT};
            color: #ffffff;
            padding: 12px 28px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            font-size: 15px;
            margin: 20px 0;
            transition: background-color 0.2s;
        }}
        .cta-button:hover {{
            background-color: #4338ca;
        }}
        .highlight-box {{
            background-color: #f3f4f6;
            border-left: 4px solid {_COLOR_ACCENT};
            padding: 16px;
            margin: 20px 0;
            border-radius: 4px;
        }}
        .highlight-box p {{
            margin: 0;
        }}
        .highlight-box ul {{
            margin: 8px 0 0 0;
            padding-left: 20px;
            font-size: 14px;
        }}
        .highlight-box li {{
            margin: 4px 0;
        }}
        .footer {{
            background-color: #f9fafb;
            padding: 24px;
            text-align: center;
            border-top: 1px solid #e5e7eb;
            font-size: 13px;
            color: #6b7280;
        }}
        .footer a {{
            color: {_COLOR_ACCENT};
            text-decoration: none;
        }}
        .footer a:hover {{
            text-decoration: underline;
        }}
        .signature {{
            margin-top: 24px;
            font-size: 14px;
            color: {_COLOR_TEXT};
        }}
        .emoji {{
            font-size: 1.2em;
        }}
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <h1>Mentible</h1>
        </div>
        <div class="content">
            {content}
        </div>
        <div class="footer">
            <p>
                Questions? Reach out to <a href="mailto:{_SUPPORT_EMAIL}">{_SUPPORT_EMAIL}</a>
            </p>
            <p style="margin: 8px 0 0 0; color: #9ca3af;">
                © 2026 Mentible. All rights reserved.<br>
                <a href="https://mentible.app" style="color: {_COLOR_ACCENT};">Visit Mentible</a>
            </p>
        </div>
    </div>
</body>
</html>"""


# ============================================================================
# REMINDER 1 (Day 15): Gentle nudge — "your work is waiting"
# ============================================================================

_REMINDER_1_NO_MEANINGFUL_ACTION = _wrap_html("""
    <h2>Your content is ready—let's publish it <span class="emoji">🚀</span></h2>
    <p>Hi there,</p>
    <p>
        We noticed you've drafted some great content but haven't published yet.
        Save and approve your work to activate it and start sharing with your audience.
    </p>
    <div class="highlight-box">
        <p><strong>Your draft is waiting for you!</strong></p>
        <p>Publishing unlocks:</p>
        <ul>
            <li>Share your work with others</li>
            <li>Build your audience</li>
            <li>Measure engagement</li>
        </ul>
    </div>
    <div style="text-align: center;">
        <a href="{app_url}" class="cta-button">Resume in Mentible</a>
    </div>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

_REMINDER_1_INVITE_UNRESPONDED = _wrap_html("""
    <h2>Your expert reviewers are waiting</h2>
    <p>Hi there,</p>
    <p>
        You've invited expert reviewers to validate your content,
        but we haven't heard back from them yet.
    </p>
    <div class="highlight-box">
        <p><strong>What you can do:</strong></p>
        <ul>
            <li>Check in with your reviewers</li>
            <li>Add additional reviewers</li>
            <li>Proceed without validation</li>
        </ul>
    </div>
    <div style="text-align: center;">
        <a href="{app_url}" class="cta-button">Check Your Project</a>
    </div>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

_REMINDER_1_PAYMENT_INCOMPLETE = _wrap_html("""
    <h2>Finish checkout to publish</h2>
    <p>Hi there,</p>
    <p>
        You're one step away from publishing!
        Complete your payment to unlock unlimited publishing.
    </p>
    <div class="highlight-box">
        <p>
            <strong>Limited time offer:</strong> Complete your purchase today and start sharing your work with the world.
        </p>
    </div>
    <div style="text-align: center;">
        <a href="{app_url}" class="cta-button">Complete Checkout</a>
    </div>
    <p style="text-align: center; font-size: 14px; color: #6b7280;">
        Questions? <a href="mailto:{_SUPPORT_EMAIL}" style="color: {_COLOR_ACCENT}; text-decoration: none;">We're here to help</a>.
    </p>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

_REMINDER_1_INACTIVE = _wrap_html("""
    <h2>Welcome back! Let's finish your project</h2>
    <p>Hi there,</p>
    <p>
        We haven't seen you in a while.
        Your project is waiting for you—pick up where you left off.
    </p>
    <div class="highlight-box">
        <p>
            <strong>Your work is safe and ready.</strong> Jump back in and complete your project.
        </p>
    </div>
    <div style="text-align: center;">
        <a href="{app_url}" class="cta-button">Open Mentible</a>
    </div>
    <p style="text-align: center; font-size: 14px; color: #6b7280;">
        We're here to help if you need anything.
    </p>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

_REMINDER_1_UNKNOWN = _wrap_html("""
    <h2>We noticed you've paused</h2>
    <p>Hi there,</p>
    <p>
        We noticed you've paused your project.
        Is there anything blocking you? We're here to help.
    </p>
    <div class="highlight-box">
        <p>
            <strong>Let us know what's up.</strong> We want to help you succeed.
        </p>
    </div>
    <div style="text-align: center;">
        <a href="{app_url}" class="cta-button">Open Mentible</a>
    </div>
    <p style="text-align: center; font-size: 14px; color: #6b7280;">
        Or just <a href="mailto:{_SUPPORT_EMAIL}" style="color: {_COLOR_ACCENT}; text-decoration: none;">reply to this email</a>.
    </p>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

REMINDER_1_TEMPLATES = {
    StallReason.NO_MEANINGFUL_ACTION: HtmlEmailTemplate(
        subject="Your content is ready—let's publish it 🚀",
        html_body=_REMINDER_1_NO_MEANINGFUL_ACTION,
    ),
    StallReason.INVITE_UNRESPONDED: HtmlEmailTemplate(
        subject="Your expert reviewers are waiting",
        html_body=_REMINDER_1_INVITE_UNRESPONDED,
    ),
    StallReason.PAYMENT_INCOMPLETE: HtmlEmailTemplate(
        subject="Finish checkout to publish",
        html_body=_REMINDER_1_PAYMENT_INCOMPLETE,
    ),
    StallReason.INACTIVE: HtmlEmailTemplate(
        subject="Welcome back! Let's finish your project",
        html_body=_REMINDER_1_INACTIVE,
    ),
    StallReason.UNKNOWN: HtmlEmailTemplate(
        subject="We noticed you've paused",
        html_body=_REMINDER_1_UNKNOWN,
    ),
}


# ============================================================================
# REMINDER 2 (Day 22): Escalation — "we're here to help, what's blocking you?"
# ============================================================================

_REMINDER_2_NO_MEANINGFUL_ACTION = _wrap_html("""
    <h2>Stuck? We can help you publish</h2>
    <p>Hi there,</p>
    <p>
        It's been a while since you drafted your content. We're curious—is something blocking you?
    </p>
    <div class="highlight-box">
        <p><strong>Common reasons users pause:</strong></p>
        <ul>
            <li>Unsure about the approval process</li>
            <li>Need to edit or refine content</li>
            <li>Questions about publishing options</li>
        </ul>
    </div>
    <div style="text-align: center;">
        <a href="mailto:{_SUPPORT_EMAIL}?subject=Help%20with%20publishing" class="cta-button">Get Support</a>
    </div>
    <p>We're here to answer any questions and help you finish.</p>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

_REMINDER_2_INVITE_UNRESPONDED = _wrap_html("""
    <h2>Need expert feedback? We can help</h2>
    <p>Hi there,</p>
    <p>
        Your reviewers haven't responded yet. Would it help to:
    </p>
    <div class="highlight-box">
        <ul>
            <li>Schedule a time with them?</li>
            <li>Add a colleague with similar expertise?</li>
            <li>Get feedback from our team instead?</li>
        </ul>
        <p style="margin-top: 12px; font-weight: 600;">
            We're here to make the review process smooth.
        </p>
    </div>
    <div style="text-align: center;">
        <a href="mailto:{_SUPPORT_EMAIL}?subject=Expert%20review%20help" class="cta-button">Talk to Us</a>
    </div>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

_REMINDER_2_PAYMENT_INCOMPLETE = _wrap_html("""
    <h2>Stuck on checkout? We're here</h2>
    <p>Hi there,</p>
    <p>
        We noticed your checkout isn't complete. Common issues:
    </p>
    <div class="highlight-box">
        <ul>
            <li>Payment method needs updating</li>
            <li>Questions about our plans</li>
            <li>Need a different payment option</li>
        </ul>
        <p style="margin-top: 12px; font-weight: 600;">
            Let us know what's holding you back—we can help.
        </p>
    </div>
    <div style="text-align: center;">
        <a href="mailto:{_SUPPORT_EMAIL}?subject=Checkout%20help" class="cta-button">Contact Support</a>
    </div>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

_REMINDER_2_INACTIVE = _wrap_html("""
    <h2>What can we help with?</h2>
    <p>Hi there,</p>
    <p>
        It's been a while! We'd love to know how we can help you get back on track.
    </p>
    <div class="highlight-box">
        <p><strong>Have questions about:</strong></p>
        <ul>
            <li>How to use a feature?</li>
            <li>Best practices for publishing?</li>
            <li>A technical issue?</li>
        </ul>
    </div>
    <div style="text-align: center;">
        <a href="mailto:{_SUPPORT_EMAIL}?subject=Help%20with%20Mentible" class="cta-button">Get in Touch</a>
    </div>
    <p>We're here to help.</p>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

_REMINDER_2_UNKNOWN = _wrap_html("""
    <h2>We're here to help—what's up?</h2>
    <p>Hi there,</p>
    <p>
        We noticed you've gone quiet. Is there something we can help with?
    </p>
    <div class="highlight-box">
        <p><strong>Let us know:</strong></p>
        <ul>
            <li>What you're working on</li>
            <li>What's blocking you</li>
            <li>How we can support you</li>
        </ul>
    </div>
    <div style="text-align: center;">
        <a href="mailto:{_SUPPORT_EMAIL}?subject=Support%20needed" class="cta-button">Reply to This Email</a>
    </div>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

REMINDER_2_TEMPLATES = {
    StallReason.NO_MEANINGFUL_ACTION: HtmlEmailTemplate(
        subject="Stuck? We can help you publish",
        html_body=_REMINDER_2_NO_MEANINGFUL_ACTION,
    ),
    StallReason.INVITE_UNRESPONDED: HtmlEmailTemplate(
        subject="Need expert feedback? We can help",
        html_body=_REMINDER_2_INVITE_UNRESPONDED,
    ),
    StallReason.PAYMENT_INCOMPLETE: HtmlEmailTemplate(
        subject="Stuck on checkout? We're here",
        html_body=_REMINDER_2_PAYMENT_INCOMPLETE,
    ),
    StallReason.INACTIVE: HtmlEmailTemplate(
        subject="What can we help with?",
        html_body=_REMINDER_2_INACTIVE,
    ),
    StallReason.UNKNOWN: HtmlEmailTemplate(
        subject="We're here to help—what's up?",
        html_body=_REMINDER_2_UNKNOWN,
    ),
}


# ============================================================================
# REMINDER 3 (Day 29): Final nudge — "last chance, here's what you're missing"
# ============================================================================

_REMINDER_3_NO_MEANINGFUL_ACTION = _wrap_html("""
    <h2>Last call: publish your work</h2>
    <p>Hi there,</p>
    <p>
        Your content is complete and ready to share. This is your last reminder before we stop reaching out.
    </p>
    <div class="highlight-box">
        <p><strong>Publishing unlocks:</strong></p>
        <ul>
            <li><span class="emoji">✓</span> Share your work with others</li>
            <li><span class="emoji">✓</span> Build your audience</li>
            <li><span class="emoji">✓</span> Measure engagement</li>
        </ul>
    </div>
    <div style="text-align: center;">
        <a href="{app_url}" class="cta-button">Publish Now</a>
    </div>
    <p style="font-size: 14px; color: #6b7280;">
        If you'd rather not, just let us know—no hard feelings.
    </p>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

_REMINDER_3_INVITE_UNRESPONDED = _wrap_html("""
    <h2>Final reminder: expert review waiting</h2>
    <p>Hi there,</p>
    <p>
        Your content is waiting for expert validation. This is your last reminder.
    </p>
    <div class="highlight-box">
        <p><strong>Next steps:</strong></p>
        <ul>
            <li>Follow up with your reviewers</li>
            <li>Or proceed without validation</li>
            <li>Or ask for our help</li>
        </ul>
    </div>
    <div style="text-align: center;">
        <a href="{app_url}" class="cta-button">Complete Review</a>
    </div>
    <p style="font-size: 14px; color: #6b7280;">
        Let us know if you need anything.
    </p>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

_REMINDER_3_PAYMENT_INCOMPLETE = _wrap_html("""
    <h2>Complete checkout—limited time</h2>
    <p>Hi there,</p>
    <p>
        Your payment isn't complete, and we can't publish without it.
    </p>
    <p>
        <strong>This is your final reminder.</strong> After this, your draft may become inaccessible.
    </p>
    <div style="text-align: center;">
        <a href="{app_url}" class="cta-button">Complete Checkout Now</a>
    </div>
    <p style="text-align: center; font-size: 14px; color: #6b7280;">
        Need help? <a href="mailto:{_SUPPORT_EMAIL}" style="color: {_COLOR_ACCENT}; text-decoration: none;">{_SUPPORT_EMAIL}</a>
    </p>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

_REMINDER_3_INACTIVE = _wrap_html("""
    <h2>Your project is waiting—final call</h2>
    <p>Hi there,</p>
    <p>
        It's been too long. Your project is still here, but this is our last email.
    </p>
    <div class="highlight-box">
        <p><strong>If you'd like to continue:</strong></p>
    </div>
    <div style="text-align: center;">
        <a href="{app_url}" class="cta-button">Open Mentible</a>
    </div>
    <p style="font-size: 14px; color: #6b7280;">
        If not, just let us know—we're happy to help you export your work.
    </p>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

_REMINDER_3_UNKNOWN = _wrap_html("""
    <h2>Last chance—we're here for you</h2>
    <p>Hi there,</p>
    <p>
        We'd hate to see you go. This is our final message.
    </p>
    <p>
        <strong>If you're stuck, let us know—we can help with anything.</strong>
    </p>
    <div style="text-align: center;">
        <a href="mailto:{_SUPPORT_EMAIL}?subject=Last%20chance%20to%20help" class="cta-button">Get in Touch</a>
    </div>
    <div class="signature">
        Best,<br>
        <strong>The Mentible Team</strong>
    </div>
""")

REMINDER_3_TEMPLATES = {
    StallReason.NO_MEANINGFUL_ACTION: HtmlEmailTemplate(
        subject="Last call: publish your work",
        html_body=_REMINDER_3_NO_MEANINGFUL_ACTION,
    ),
    StallReason.INVITE_UNRESPONDED: HtmlEmailTemplate(
        subject="Final reminder: expert review waiting",
        html_body=_REMINDER_3_INVITE_UNRESPONDED,
    ),
    StallReason.PAYMENT_INCOMPLETE: HtmlEmailTemplate(
        subject="Complete checkout—limited time",
        html_body=_REMINDER_3_PAYMENT_INCOMPLETE,
    ),
    StallReason.INACTIVE: HtmlEmailTemplate(
        subject="Your project is waiting—final call",
        html_body=_REMINDER_3_INACTIVE,
    ),
    StallReason.UNKNOWN: HtmlEmailTemplate(
        subject="Last chance—we're here for you",
        html_body=_REMINDER_3_UNKNOWN,
    ),
}


def get_html_email_template(stall_reason: StallReason, attempt_count: int) -> HtmlEmailTemplate:
    """Select HTML email template by stall reason + attempt number (1, 2, or 3).

    Args:
        stall_reason: Why the user stalled
        attempt_count: Intervention attempt number (1st, 2nd, or 3rd)

    Returns:
        HtmlEmailTemplate (subject + html_body) with {app_url} placeholder
    """
    if attempt_count == 1:
        templates = REMINDER_1_TEMPLATES
    elif attempt_count == 2:
        templates = REMINDER_2_TEMPLATES
    elif attempt_count == 3:
        templates = REMINDER_3_TEMPLATES
    else:
        # Fallback for unexpected attempt numbers
        templates = REMINDER_3_TEMPLATES

    return templates.get(stall_reason, templates[StallReason.UNKNOWN])
