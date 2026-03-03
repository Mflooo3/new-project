from app.models import Alert, Event


def build_alerts(event: Event) -> list[Alert]:
    alerts: list[Alert] = []
    tags = set((event.tags or "").split(","))
    text = " ".join(filter(None, [event.title, event.summary, event.details])).lower()

    if event.severity >= 4:
        alerts.append(
            Alert(
                event_id=event.id or 0,
                level="high",
                title=f"High severity: {event.title}",
                details=event.ai_assessment or "High-severity event detected.",
            )
        )
    elif event.severity == 3:
        alerts.append(
            Alert(
                event_id=event.id or 0,
                level="medium",
                title=f"Moderate risk: {event.title}",
                details=event.ai_assessment or "Moderate-risk event detected.",
            )
        )

    if {"security"} & tags and "hormuz" in text:
        alerts.append(
            Alert(
                event_id=event.id or 0,
                level="high",
                title="Strait of Hormuz security signal",
                details="Security-tagged development references Hormuz; immediate analyst review advised.",
            )
        )

    unique: dict[tuple[str, str], Alert] = {}
    for alert in alerts:
        unique[(alert.level, alert.title)] = alert
    return list(unique.values())
