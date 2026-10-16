# Flea

Flea discovers Zero-K battles and makes their replays available for browsing and analysis.

## Language

**Battle**:
A Zero-K match identified by its battle archive entry.

**Replay**:
The recorded simulation inputs for a Battle, requiring its matching engine and game content to reproduce the match.
_Avoid_: Telemetry

**Telemetry**:
The observations exported while reproducing a Replay, including player identities, unit events, and sampled movement.
_Avoid_: Replay

**Ready Replay**:
A Replay whose complete Telemetry has passed validation, including explicit evidence of full spectator visibility.
_Avoid_: Downloaded Replay

**Blocked Replay**:
A Replay that cannot currently be processed, with an identified reason visible to the person browsing it.

