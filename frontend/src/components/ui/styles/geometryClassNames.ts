/**
 * The host global class names that are declared API.
 *
 * Component kits, customer `theme.css` overlays and the Outlook add-in all
 * paste these as bare string literals, so they are a public contract even
 * though nothing imports them across the boundary: renaming one here is a
 * breaking change for every kit and theme that targets it, and — unlike a
 * dropped export — it fails silently, as an override that simply stops
 * applying. Add a name here when a class becomes themeable; never rename one
 * in `globals.css` without shipping a migration for it.
 *
 * Membership follows the suffix channels: every `globals.css` rule head
 * carrying a `-geometry` or `-skin` token, plus the handful of themeable names
 * that predate the convention. Sizing and tone modifiers that only the owning
 * host component applies (`card-inset-*`, `card-nested`, `card-section`,
 * `spinner-{sm,md,lg,xl,fill}`, `sidebar-band-flush`) stay out, as do the
 * viewer and scrollbar utilities, which are implementation detail.
 */
export const ERATO_GEOMETRY_CLASS = Object.freeze({
  alertGeometry: "alert-geometry",
  anchoredPopoverSkin: "anchored-popover-skin",
  appShellSkin: "app-shell-skin",
  attachmentBadgeGeometry: "attachment-badge-geometry",
  attachmentGroupFrameGeometry: "attachment-group-frame-geometry",
  attachmentGroupGeometry: "attachment-group-geometry",
  attachmentGroupHeaderGeometry: "attachment-group-header-geometry",
  attachmentGroupItemsGeometry: "attachment-group-items-geometry",
  attachmentNoticeGeometry: "attachment-notice-geometry",
  attachmentNoticeIconSkin: "attachment-notice-icon-skin",
  attachmentNoticeLabelSkin: "attachment-notice-label-skin",
  attachmentNoticeSkin: "attachment-notice-skin",
  attachmentTileGeometry: "attachment-tile-geometry",
  attachmentTileIconGeometry: "attachment-tile-icon-geometry",
  attachmentTileIconSkin: "attachment-tile-icon-skin",
  avatarGeometry: "avatar-geometry",
  btnGeometryIconLg: "btn-geometry-icon-lg",
  btnGeometryIconMd: "btn-geometry-icon-md",
  btnGeometryIconSm: "btn-geometry-icon-sm",
  btnGeometryLg: "btn-geometry-lg",
  btnGeometryMd: "btn-geometry-md",
  btnGeometrySm: "btn-geometry-sm",
  cardBodyGeometry: "card-body-geometry",
  cardGeometry: "card-geometry",
  cardSkin: "card-skin",
  chatBodySkin: "chat-body-skin",
  chatHeaderSkin: "chat-header-skin",
  chatInputControlsGeometry: "chat-input-controls-geometry",
  chatInputShellGeometry: "chat-input-shell-geometry",
  chatInputShellSkin: "chat-input-shell-skin",
  chatInputTextareaGeometry: "chat-input-textarea-geometry",
  chatMessageSkin: "chat-message-skin",
  dropdownItemGeometry: "dropdown-item-geometry",
  dropdownPanelChromeGeometry: "dropdown-panel-chrome-geometry",
  floatingControlSkin: "floating-control-skin",
  focusRing: "focus-ring",
  focusRingInset: "focus-ring-inset",
  focusRingTight: "focus-ring-tight",
  /**
   * Tailwind's hover-scope marker, not a `globals.css` rule. Host message
   * controls compile their `group-hover:` variants to `.group:hover`, so a kit
   * wrapping them has to carry a literal `group` class for the host's own
   * styles to reach into the kit's markup.
   */
  group: "group",
  listRowGeometry: "list-row-geometry",
  messageFrameGeometry: "message-frame-geometry",
  modalCloseGeometry: "modal-close-geometry",
  modalOverlaySkin: "modal-overlay-skin",
  modalSectionGeometry: "modal-section-geometry",
  modalShellFrameGeometry: "modal-shell-frame-geometry",
  modalShellSkin: "modal-shell-skin",
  optionCardGeometry: "option-card-geometry",
  pageShellSkin: "page-shell-skin",
  pillGeometry: "pill-geometry",
  sidebarBandGeometry: "sidebar-band-geometry",
  sidebarContentColGeometry: "sidebar-content-col-geometry",
  sidebarIconColGeometry: "sidebar-icon-col-geometry",
  sidebarIconColGeometryAvatar: "sidebar-icon-col-geometry-avatar",
  sidebarIconColGeometryLogo: "sidebar-icon-col-geometry-logo",
  sidebarInsetGeometry: "sidebar-inset-geometry",
  sidebarLabelColGeometry: "sidebar-label-col-geometry",
  sidebarRowGeometry: "sidebar-row-geometry",
  sidebarRowSelected: "sidebar-row-selected",
  sidebarSectionSkin: "sidebar-section-skin",
  sidebarSkin: "sidebar-skin",
  sidebarTrailingColGeometry: "sidebar-trailing-col-geometry",
  spinnerGeometry: "spinner-geometry",
  tabItemGeometry: "tab-item-geometry",
  tabRailGeometry: "tab-rail-geometry",
  tabRailTrackGeometry: "tab-rail-track-geometry",
  themeTransition: "theme-transition",
  threadMessageCardGeometry: "thread-message-card-geometry",
} as const);

export type EratoGeometryClassKey = keyof typeof ERATO_GEOMETRY_CLASS;
