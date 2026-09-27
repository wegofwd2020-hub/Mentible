"""Email templates for follow-up reminders by intervention attempt number.

3-tier escalation: educational → supportive → final call-to-action.
Templates are stage-agnostic; text is customized by stall_reason.
"""

from dataclasses import dataclass

from backend.src.analytics.models import StallReason


@dataclass(frozen=True)
class EmailTemplate:
    """Email template with subject + body."""

    subject: str
    body: str


# Attempt 1 (day 15): Gentle nudge — "your work is waiting"
REMINDER_1_TEMPLATES = {
    StallReason.NO_MEANINGFUL_ACTION: EmailTemplate(
        subject="Your content is ready—let's publish it 🚀",
        body="""Hi there,

We noticed you've drafted some great content but haven't published yet.
Save and approve your work to activate it and start sharing with your audience.

👉 Resume in Mentible: {app_url}

Your draft is waiting for you!

Best,
The Mentible Team""",
    ),
    StallReason.INVITE_UNRESPONDED: EmailTemplate(
        subject="Your expert reviewers are waiting",
        body="""Hi there,

You've invited expert reviewers to validate your content,
but we haven't heard back from them yet.

You can:
- Check in with your reviewers
- Add additional reviewers
- Proceed without validation

👉 Check your project: {app_url}

Best,
The Mentible Team""",
    ),
    StallReason.PAYMENT_INCOMPLETE: EmailTemplate(
        subject="Finish checkout to publish",
        body="""Hi there,

You're one step away from publishing!
Complete your payment to unlock unlimited publishing.

👉 Complete checkout: {app_url}

Questions? We're here to help.

Best,
The Mentible Team""",
    ),
    StallReason.INACTIVE: EmailTemplate(
        subject="Welcome back! Let's finish your project",
        body="""Hi there,

We haven't seen you in a while.
Your project is waiting for you—pick up where you left off.

👉 Open Mentible: {app_url}

We're here to help if you need anything.

Best,
The Mentible Team""",
    ),
    StallReason.UNKNOWN: EmailTemplate(
        subject="We noticed you've paused",
        body="""Hi there,

We noticed you've paused your project.
Is there anything blocking you? We're here to help.

👉 Open Mentible: {app_url}

Just reply to this email or reach out to support@kaundinyalabs.com.

Best,
The Mentible Team""",
    ),
}

# Attempt 2 (day 22): Escalation — "we're here to help, what's blocking you?"
REMINDER_2_TEMPLATES = {
    StallReason.NO_MEANINGFUL_ACTION: EmailTemplate(
        subject="Stuck? We can help you publish",
        body="""Hi there,

It's been a while since you drafted your content. We're curious—is something blocking you?

Common reasons users pause:
- Unsure about the approval process
- Need to edit or refine content
- Questions about publishing options

👉 Get support: support@kaundinyalabs.com

We're here to answer any questions and help you finish.

Best,
The Mentible Team""",
    ),
    StallReason.INVITE_UNRESPONDED: EmailTemplate(
        subject="Need expert feedback? We can help",
        body="""Hi there,

Your reviewers haven't responded yet. Would it help to:
- Schedule a time with them?
- Add a colleague with similar expertise?
- Get feedback from our team instead?

We're here to make the review process smooth.

👉 Talk to us: support@kaundinyalabs.com

Best,
The Mentible Team""",
    ),
    StallReason.PAYMENT_INCOMPLETE: EmailTemplate(
        subject="Stuck on checkout? We're here",
        body="""Hi there,

We noticed your checkout isn't complete. Common issues:
- Payment method needs updating
- Questions about our plans
- Need a different payment option

Let us know what's holding you back—we can help.

👉 Contact support: support@kaundinyalabs.com

Best,
The Mentible Team""",
    ),
    StallReason.INACTIVE: EmailTemplate(
        subject="What can we help with?",
        body="""Hi there,

It's been a while! We'd love to know how we can help you get back on track.

Have questions about:
- How to use a feature?
- Best practices for publishing?
- A technical issue?

We're here to help.

👉 Get in touch: support@kaundinyalabs.com

Best,
The Mentible Team""",
    ),
    StallReason.UNKNOWN: EmailTemplate(
        subject="We're here to help—what's up?",
        body="""Hi there,

We noticed you've gone quiet. Is there something we can help with?

Let us know:
- What you're working on
- What's blocking you
- How we can support you

👉 Reply to this email or reach out: support@kaundinyalabs.com

Best,
The Mentible Team""",
    ),
}

# Attempt 3 (day 29): Final nudge — "last chance, here's what you're missing"
REMINDER_3_TEMPLATES = {
    StallReason.NO_MEANINGFUL_ACTION: EmailTemplate(
        subject="Last call: publish your work",
        body="""Hi there,

Your content is complete and ready to share. This is your last reminder before we stop reaching out.

Publishing unlocks:
✓ Share your work with others
✓ Build your audience
✓ Measure engagement

👉 Publish now: {app_url}

If you'd rather not, just let us know—no hard feelings.

Best,
The Mentible Team""",
    ),
    StallReason.INVITE_UNRESPONDED: EmailTemplate(
        subject="Final reminder: expert review waiting",
        body="""Hi there,

Your content is waiting for expert validation. This is your last reminder.

Next steps:
1. Follow up with your reviewers
2. Or proceed without validation
3. Or ask for our help

👉 Complete review: {app_url}

Let us know if you need anything.

Best,
The Mentible Team""",
    ),
    StallReason.PAYMENT_INCOMPLETE: EmailTemplate(
        subject="Complete checkout—limited time",
        body="""Hi there,

Your payment isn't complete, and we can't publish without it.

This is your final reminder. After this, your draft may become inaccessible.

👉 Complete checkout now: {app_url}

Need help? support@kaundinyalabs.com

Best,
The Mentible Team""",
    ),
    StallReason.INACTIVE: EmailTemplate(
        subject="Your project is waiting—final call",
        body="""Hi there,

It's been too long. Your project is still here, but this is our last email.

If you'd like to continue:
👉 Open Mentible: {app_url}

If not, just let us know—we're happy to help you export your work.

Best,
The Mentible Team""",
    ),
    StallReason.UNKNOWN: EmailTemplate(
        subject="Last chance—we're here for you",
        body="""Hi there,

We'd hate to see you go. This is our final message.

If you're stuck, let us know—we can help with anything.

👉 Get in touch: support@kaundinyalabs.com

Best,
The Mentible Team""",
    ),
}


def get_email_template(stall_reason: StallReason, attempt_count: int) -> EmailTemplate:
    """Select email template by stall reason + attempt number (1, 2, or 3).

    Args:
        stall_reason: Why the user stalled
        attempt_count: Intervention attempt number (1st, 2nd, or 3rd)

    Returns:
        EmailTemplate (subject + body) with {app_url} placeholder
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
