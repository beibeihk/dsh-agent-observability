# ADR-002: Durable Session evidence is authoritative

Status: accepted.

Live streams are transient and may represent discarded retries; the committed session log supports restart, fork and context reconstruction. V1 derives evidence from `session/event`, with async observation leases for seed/HMR replay. It never invents model-visible history from private live state. This sacrifices pre-settlement attempt timing and body-only tool measurements, but keeps every finding traceable to durable seqs. Surface replacements and fork inheritance remain explicit.
