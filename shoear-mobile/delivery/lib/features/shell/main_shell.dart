import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/features/auth/state/auth_provider.dart';
import 'package:delivery/features/auth/screens/login_screen.dart';
import 'package:delivery/features/delivery/screens/assignments_screen.dart';
import 'package:delivery/features/delivery/screens/history_screen.dart';
import 'package:delivery/features/profile/screens/profile_screen.dart';

/// Top-level shell: shows the login screen until a courier signs in, then a
/// two-tab bar (active deliveries / history).
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final loggedIn = context.watch<AuthProvider>().isLoggedIn;
    if (!loggedIn) return const LoginScreen();

    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: const [AssignmentsScreen(), HistoryScreen(), ProfileScreen()],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.local_shipping_outlined), selectedIcon: Icon(Icons.local_shipping), label: 'Deliveries'),
          NavigationDestination(icon: Icon(Icons.history), label: 'History'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}
