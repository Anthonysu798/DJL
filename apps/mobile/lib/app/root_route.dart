enum AppSection { cloud, myMacs }

enum RootRoute { welcome, cloud, myMacs }

RootRoute resolveRootRoute(AppSection section, {required bool signedIn}) =>
    switch (section) {
      AppSection.myMacs => RootRoute.myMacs,
      AppSection.cloud => signedIn ? RootRoute.cloud : RootRoute.welcome,
    };
