// ERMAIN-963: DevicePermissionService availability does not reliably indicate
// microphone support (notably in Classic Outlook). Use browser consent until
// the Office permission flow is reworked; retain the implementation for then.
export const OFFICE_AUDIO_PERMISSION_GATE_ENABLED = false;
