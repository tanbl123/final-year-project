import 'package:flutter/foundation.dart';

import 'package:customer/features/wishlist/models/wishlist.dart';
import 'package:customer/features/wishlist/services/wishlist_service.dart';

/// Holds the customer's wishlist. The screen's item list is paginated (infinite
/// scroll), but the FULL set of saved product ids is always kept so any screen
/// can cheaply show a filled/empty heart. Loads on login, clears on logout.
class WishlistProvider extends ChangeNotifier {
  final WishlistService _service;
  WishlistProvider(this._service);

  Wishlist? _wishlist;            // accumulated items for the wishlist screen
  Wishlist? get wishlist => _wishlist;
  int _total = 0;
  int _page = 1;
  int get count => _total;        // total saved (badge), not the loaded page size
  bool get hasMore => (_wishlist?.items.length ?? 0) < _total;

  Set<String> _savedIds = {};     // ALL saved product ids — drives hearts app-wide
  bool isSaved(String productId) => _savedIds.contains(productId);

  bool _loading = false;
  bool get loading => _loading;
  bool _loadingMore = false;
  bool get loadingMore => _loadingMore;
  String? error;

  bool? _wasLoggedIn;

  void syncWithAuth(bool loggedIn) {
    if (_wasLoggedIn == loggedIn) return;
    _wasLoggedIn = loggedIn;
    if (loggedIn) {
      Future.microtask(refresh);
    } else {
      _wishlist = null;
      _savedIds = {};
      _total = 0;
      _page = 1;
      error = null;
      Future.microtask(notifyListeners);
    }
  }

  // (Re)load from page 1.
  Future<void> refresh() async {
    _loading = true;
    error = null;
    notifyListeners();
    try {
      final w = await _service.getWishlist(page: 1);
      _wishlist = w;
      _savedIds = w.savedIds.toSet();
      _total = w.total;
      _page = 1;
    } catch (e) {
      error = e.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  // Append the next page as the user scrolls.
  Future<void> loadMore() async {
    if (_loadingMore || _loading || !hasMore || _wishlist == null) return;
    _loadingMore = true;
    notifyListeners();
    try {
      final next = await _service.getWishlist(page: _page + 1);
      _wishlist = Wishlist(
        wishlistId: next.wishlistId,
        items: [..._wishlist!.items, ...next.items],
        itemCount: next.total,
        total: next.total,
        page: next.page,
        savedIds: next.savedIds,
      );
      _savedIds = next.savedIds.toSet();
      _total = next.total;
      _page = next.page;
    } catch (_) {
      // keep what we have; the user can scroll again to retry
    } finally {
      _loadingMore = false;
      notifyListeners();
    }
  }

  Future<void> add(String productId) async {
    final w = await _service.add(productId);
    _savedIds = w.savedIds.toSet(); // full set stays correct for hearts
    _total = w.total;
    notifyListeners(); // new item appears on the wishlist screen's next refresh
  }

  Future<void> remove(String productId) async {
    final w = await _service.remove(productId);
    _savedIds = w.savedIds.toSet();
    _total = w.total;
    // Drop it from the currently-shown list so it disappears immediately.
    if (_wishlist != null) {
      _wishlist = Wishlist(
        wishlistId: _wishlist!.wishlistId,
        items: _wishlist!.items.where((e) => e.productId != productId).toList(),
        itemCount: _total,
        total: _total,
        page: _page,
        savedIds: w.savedIds,
      );
    }
    notifyListeners();
  }

  /// Heart toggle — throws [ApiException] on failure (the caller shows it).
  Future<void> toggle(String productId) =>
      isSaved(productId) ? remove(productId) : add(productId);
}
