import 'package:flutter/foundation.dart';

/// A tiny app-wide "something changed, re-fetch" signal.
///
/// Bumped when a push notification arrives (a status likely changed) or when
/// the app returns to the foreground. Screens that show server state — e.g. My
/// Orders and the order detail — listen to this and refresh, giving a
/// near-real-time feel without polling or websockets.
final ValueNotifier<int> appRefreshTick = ValueNotifier<int>(0);

/// Trigger a refresh across all listening screens.
void bumpRefresh() => appRefreshTick.value++;
