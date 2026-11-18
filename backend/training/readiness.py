"""Readiness score: one 0-100 number from the pre-workout check-in.

Keep in sync with readinessScore in frontend/src/features/workout/rpe.ts. Every answer counts the
same; stress and soreness count in reverse. It is a self-assessment of recovery, not a medical
judgement, and nothing changes the training load automatically because of it.
"""

# (field, inverted): inverted scales mean "more of it is worse" (more stress, more soreness).
SCALE_FIELDS = (
    ('motivation', False),
    ('stress', True),
    ('soreness_upper', True),
    ('soreness_lower', True),
    ('hydration', False),
)
ANSWER_FIELDS = ('sleep_hours', *(field for field, _ in SCALE_FIELDS))


def _sleep_score(hours: int) -> int:
    if hours >= 8:
        return 5
    if hours <= 4:
        return 1
    return hours - 3  # 5 h -> 2, 6 h -> 3, 7 h -> 4


def readiness_answers(session) -> dict:
    """The answers given (unanswered ones left out)."""
    return {field: getattr(session, field) for field in ANSWER_FIELDS if getattr(session, field) is not None}


def readiness_score(answers: dict) -> int | None:
    scores = []
    if answers.get('sleep_hours') is not None:
        scores.append(_sleep_score(answers['sleep_hours']))
    for field, inverted in SCALE_FIELDS:
        value = answers.get(field)
        if value is not None:
            scores.append(6 - value if inverted else value)
    if not scores:
        return None
    average = sum(scores) / len(scores)
    # Math.round in the frontend: halves round up (Python's round() would round them to even).
    return int((average - 1) / 4 * 100 + 0.5)
