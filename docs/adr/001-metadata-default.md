# ADR-001: Metadata-only by default

Status: accepted.

Reliability debugging often needs sequence, identity, outcome, timing and repeat detection without needing complete prompts. Defaulting to content capture would expose user inputs, tool outputs and embedded credentials when a report is shared. V1 exports redacted fingerprints, uses a private recorder-local HMAC for argument equality, and requires explicit opt-in for bounded redacted content. Pattern redaction is a defense, not a universal confidentiality guarantee.
