import analytics from '@react-native-firebase/analytics';

// ── Screen Tracking ──

export function logScreenView(screenName: string, screenClass?: string) {
  analytics().logScreenView({
    screen_name: screenName,
    screen_class: screenClass ?? screenName,
  });
}

// ── Onboarding ──

export function logOnboardingPageView(page: string, index: number) {
  analytics().logEvent('onboarding_page_view', { page, index });
}

export function logOnboardingNext(fromPage: number) {
  analytics().logEvent('onboarding_next', { from_page: fromPage });
}

export function logOnboardingHaveInviteCode(from: 'carousel' | 'waitlist') {
  analytics().logEvent('onboarding_have_invite_code', { from });
}

export function logOnboardingJoinWaitlist() {
  analytics().logEvent('onboarding_join_waitlist');
}

// ── Invite Code ──

export function logInviteCodeSubmit() {
  analytics().logEvent('invite_code_submit');
}

export function logInviteCodeSuccess() {
  analytics().logEvent('invite_code_success');
}

export function logInviteCodeError(reason: string) {
  analytics().logEvent('invite_code_error', { reason });
}

// ── Vault Setup ──

export function logVaultSetupStart() {
  analytics().logEvent('vault_setup_start');
}

export function logVaultSetupWalletConnected() {
  analytics().logEvent('vault_setup_wallet_connected');
}

export function logVaultSetupSuccess() {
  analytics().logEvent('vault_setup_success');
}

export function logVaultSetupError(error: string) {
  analytics().logEvent('vault_setup_error', { error: error.slice(0, 100) });
}

export function logVaultSetupInsufficientBalance(balance: number) {
  analytics().logEvent('vault_setup_insufficient_balance', { balance });
}

// ── Waitlist ──

export function logWaitlistTaskPress(taskId: string) {
  analytics().logEvent('waitlist_task_press', { task_id: taskId });
}

export function logWaitlistTaskComplete(taskId: string, xpReward: number) {
  analytics().logEvent('waitlist_task_complete', { task_id: taskId, xp_reward: xpReward });
}

export function logWaitlistApproved() {
  analytics().logEvent('waitlist_approved');
}

// ── PIN ──

export function logPinSetupComplete() {
  analytics().logEvent('pin_setup_complete');
}

export function logPinSetupMismatch() {
  analytics().logEvent('pin_setup_mismatch');
}

export function logPinChangeStart() {
  analytics().logEvent('pin_change_start');
}

export function logPinChangeComplete() {
  analytics().logEvent('pin_change_complete');
}

export function logPinChangeWrongPin() {
  analytics().logEvent('pin_change_wrong_pin');
}

export function logPinChangeMismatch() {
  analytics().logEvent('pin_change_mismatch');
}

// ── Biometric / Lock ──

export function logBiometricUnlockAttempt() {
  analytics().logEvent('biometric_unlock_attempt');
}

export function logBiometricUnlockSuccess() {
  analytics().logEvent('biometric_unlock_success');
}

export function logPinUnlockSuccess() {
  analytics().logEvent('pin_unlock_success');
}

export function logPinUnlockFailed() {
  analytics().logEvent('pin_unlock_failed');
}

export function logAppLocked() {
  analytics().logEvent('app_locked');
}

// ── Tab Navigation ──

export function logTabPress(tab: string) {
  analytics().logEvent('tab_press', { tab });
}

// ── Home Screen Actions ──

export function logHomeActionPress(action: string) {
  analytics().logEvent('home_action_press', { action });
}

export function logNotificationsBellPress(unreadCount: number) {
  analytics().logEvent('notifications_bell_press', { unread_count: unreadCount });
}

export function logSupportLinkPress() {
  analytics().logEvent('support_link_press');
}

export function logQuestionsLinkPress() {
  analytics().logEvent('questions_link_press');
}

export function logSuggestionPress(suggestionId: string) {
  analytics().logEvent('suggestion_press', { suggestion_id: suggestionId });
}

export function logSectionMorePress(section: string) {
  analytics().logEvent('section_more_press', { section });
}

// ── Receive ──

export function logReceiveModalOpen() {
  analytics().logEvent('receive_modal_open');
}

export function logReceiveAddressCopy() {
  analytics().logEvent('receive_address_copy');
}

export function logReceiveFundFromSeeker() {
  analytics().logEvent('receive_fund_from_seeker');
}

// ── Send ──

export function logSendModalOpen() {
  analytics().logEvent('send_modal_open');
}

export function logSendTokenSelect(symbol: string, mint: string) {
  analytics().logEvent('send_token_select', { symbol, mint: mint.slice(0, 44) });
}

export function logSendMaxPress(symbol: string) {
  analytics().logEvent('send_max_press', { symbol });
}

export function logSendPasteAddress() {
  analytics().logEvent('send_paste_address');
}

export function logSendSubmit(symbol: string, amount: string) {
  analytics().logEvent('send_submit', { symbol, amount });
}

export function logSendSuccess(symbol: string, amount: string) {
  analytics().logEvent('send_success', { symbol, amount });
}

export function logSendError(symbol: string, error: string) {
  analytics().logEvent('send_error', { symbol, error: error.slice(0, 100) });
}

// ── Earn / Vault Modal ──

export function logEarnFilterSelect(filter: string) {
  analytics().logEvent('earn_filter_select', { filter });
}

export function logEarnVaultPress(symbol: string, vaultAddress: string, type: string) {
  analytics().logEvent('earn_vault_press', { symbol, vault_address: vaultAddress.slice(0, 44), type });
}

export function logEarnRetry() {
  analytics().logEvent('earn_retry');
}

export function logVaultModalOpen(symbol: string, mode: string) {
  analytics().logEvent('vault_modal_open', { symbol, mode });
}

export function logVaultModeSwitch(mode: string) {
  analytics().logEvent('vault_mode_switch', { mode });
}

export function logVaultMaxPress(mode: string, symbol: string) {
  analytics().logEvent('vault_max_press', { mode, symbol });
}

export function logVaultSubmit(mode: string, symbol: string, amount: string, type: string) {
  analytics().logEvent('vault_submit', { mode, symbol, amount, type });
}

export function logVaultSuccess(mode: string, symbol: string, amount: string, type: string) {
  analytics().logEvent('vault_success', { mode, symbol, amount, type });
}

export function logVaultError(mode: string, symbol: string, error: string) {
  analytics().logEvent('vault_error', { mode, symbol, error: error.slice(0, 100) });
}

// ── More Screen ──

export function logMoreNavigate(screen: string) {
  analytics().logEvent('more_navigate', { screen });
}

export function logCopyAddress(field: string) {
  analytics().logEvent('copy_address', { field });
}

export function logCopyPrivateKey(keyType: string) {
  analytics().logEvent('copy_private_key', { key_type: keyType });
}

export function logReclaimRentPress() {
  analytics().logEvent('reclaim_rent_press');
}

export function logReclaimRentSuccess(closed: number, skipped: number, failed: number) {
  analytics().logEvent('reclaim_rent_success', { closed, skipped, failed });
}

export function logReclaimRentError(error: string) {
  analytics().logEvent('reclaim_rent_error', { error: error.slice(0, 100) });
}

export function logRemoveVaultPress() {
  analytics().logEvent('remove_vault_press');
}

export function logRemoveVaultConfirm() {
  analytics().logEvent('remove_vault_confirm');
}

// ── Squads ──

export function logSquadsCreateVaultPress() {
  analytics().logEvent('squads_create_vault_press');
}

export function logSquadsCreateVaultSuccess() {
  analytics().logEvent('squads_create_vault_success');
}

export function logSquadsCreateVaultError(error: string) {
  analytics().logEvent('squads_create_vault_error', { error: error.slice(0, 100) });
}

export function logSquadsCopyAddress() {
  analytics().logEvent('squads_copy_address');
}

export function logSquadsAddMemberPress() {
  analytics().logEvent('squads_add_member_press');
}

// ── Notifications ──

export function logNotificationPress(type: string, read: boolean) {
  analytics().logEvent('notification_press', { type, was_read: read });
}

export function logNotificationLoadMore() {
  analytics().logEvent('notification_load_more');
}

// ── Coming Soon ──

export function logComingSoonView(feature: string) {
  analytics().logEvent('coming_soon_view', { feature });
}

// ── Push Notifications ──

export function logPushNotificationReceived(title: string) {
  analytics().logEvent('push_notification_received', { title: title.slice(0, 100) });
}

// ── App Lifecycle ──

export function logAppInit(hasVault: boolean, hasPin: boolean) {
  analytics().logEvent('app_init', { has_vault: hasVault, has_pin: hasPin });
}

// ── Errors (generic) ──

export function logError(context: string, error: string) {
  analytics().logEvent('app_error', { context, error: error.slice(0, 100) });
}

// ── Push Notification Permission ──

export function logPushPermissionGranted() {
  analytics().logEvent('push_permission_granted');
}

export function logPushPermissionDenied() {
  analytics().logEvent('push_permission_denied');
}

// ── Suggestion Card ──

export function logSuggestionCardPress(suggestionId: string, type: string) {
  analytics().logEvent('suggestion_card_press', { suggestion_id: suggestionId, type });
}

// ── Connect Email ──

export function logEmailCodeSent() {
  analytics().logEvent('email_code_sent');
}

export function logEmailCodeError(reason: string) {
  analytics().logEvent('email_code_error', { reason });
}

export function logEmailVerifySuccess() {
  analytics().logEvent('email_verify_success');
}

export function logEmailVerifyError(reason: string) {
  analytics().logEvent('email_verify_error', { reason });
}

// ── Connect Telegram ──

export function logTelegramCodeCopy() {
  analytics().logEvent('telegram_code_copy');
}

export function logTelegramBotOpen() {
  analytics().logEvent('telegram_bot_open');
}

// ── Verify Action (Waitlist) ──

export function logVerifyActionOpen(taskId: string) {
  analytics().logEvent('verify_action_open', { task_id: taskId });
}

export function logVerifyActionAttempt(taskId: string) {
  analytics().logEvent('verify_action_attempt', { task_id: taskId });
}

export function logVerifyActionSuccess(taskId: string) {
  analytics().logEvent('verify_action_success', { task_id: taskId });
}

export function logVerifyActionError(taskId: string, reason: string) {
  analytics().logEvent('verify_action_error', { task_id: taskId, reason: reason.slice(0, 100) });
}

// ── Upload Screenshot ──

export function logScreenshotStoreOpen() {
  analytics().logEvent('screenshot_store_open');
}

export function logScreenshotImageSelected() {
  analytics().logEvent('screenshot_image_selected');
}

export function logScreenshotSubmit(taskId: string) {
  analytics().logEvent('screenshot_submit', { task_id: taskId });
}

export function logScreenshotSuccess(taskId: string) {
  analytics().logEvent('screenshot_success', { task_id: taskId });
}

export function logScreenshotError(taskId: string, reason: string) {
  analytics().logEvent('screenshot_error', { task_id: taskId, reason: reason.slice(0, 100) });
}

// ── Fund Wallet ──

export function logFundWalletModalOpen() {
  analytics().logEvent('fund_wallet_modal_open');
}

export function logFundWalletConnect() {
  analytics().logEvent('fund_wallet_connect');
}

export function logFundWalletTokenSelect(symbol: string) {
  analytics().logEvent('fund_wallet_token_select', { symbol });
}

export function logFundWalletMaxPress(symbol: string) {
  analytics().logEvent('fund_wallet_max_press', { symbol });
}

export function logFundWalletSubmit(symbol: string, amount: string) {
  analytics().logEvent('fund_wallet_submit', { symbol, amount });
}

export function logFundWalletSuccess(symbol: string, amount: string) {
  analytics().logEvent('fund_wallet_success', { symbol, amount });
}

export function logFundWalletError(symbol: string, error: string) {
  analytics().logEvent('fund_wallet_error', { symbol, error: error.slice(0, 100) });
}

// ── Add Member ──

export function logAddMemberSubmit(permissionType: string) {
  analytics().logEvent('add_member_submit', { permission_type: permissionType });
}

export function logAddMemberSuccess() {
  analytics().logEvent('add_member_success');
}

// ── Keys & Recovery ──

export function logAddRecoveryKeyPress() {
  analytics().logEvent('add_recovery_key_press');
}

export function logAddRecoveryKeySubmit() {
  analytics().logEvent('add_recovery_key_submit');
}

export function logAddRecoveryKeySuccess() {
  analytics().logEvent('add_recovery_key_success');
}

export function logAddRecoveryKeyError(error: string) {
  analytics().logEvent('add_recovery_key_error', { error: error.slice(0, 100) });
}

// ── User Properties ──

export function setUserHasVault(hasVault: boolean) {
  analytics().setUserProperty('has_vault', hasVault ? 'true' : 'false');
}

export function setUserOnWaitlist(onWaitlist: boolean) {
  analytics().setUserProperty('on_waitlist', onWaitlist ? 'true' : 'false');
}
