# Album CRT for Google TV

Experimental native Android TV app using the existing WiiM / Kan 88 album module, bundled as local web assets. The native client only reads the fixed WiiM Pro address and the two documented playback GET commands plus the AirPlay artwork. HTTPS validation is kept enabled. The first TV test will establish whether the WiiM certificate is trusted by Android; if it is not, a device-specific trust setup is required before live playback works.

Build: `gradle -p android-tv assembleDebug` (Gradle 8.10.2, JDK 17, Android SDK 35). Install the debug APK on Google TV. It launches fullscreen, and shows a large status bar only if the native connection fails.

The existing GitHub Pages website is unchanged. No Last.fm credentials are used.
