; Extra steps for the app installers (electron-builder includes build/installer.nsh by itself).
; The wizard pictures (installerSidebar.bmp on the Welcome / Finish pages, installerHeader.bmp on
; the other pages) sit next to this file and are picked up by name as well.

!include LogicLib.nsh

; After installing or updating: tell Windows to refresh its icons, so the desktop and Start-menu
; shortcuts show the 2CQR GARUDA eagle straight away. An update installs into the same folder as
; the previous version, and without this Windows can keep showing the old version's icon.
; Runs after the shortcuts are created.
!macro customInstall
  ; Explorer reloads file and shortcut icons (SHCNE_ASSOCCHANGED, SHCNF_FLUSH).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
  ; Refresh the icon cache (Windows 10 / 11). The installer is a 32-bit program: on 64-bit Windows
  ; the real System32 is reached through Sysnative.
  Push $0
  ${If} ${FileExists} "$WINDIR\Sysnative\ie4uinit.exe"
    nsExec::Exec '"$WINDIR\Sysnative\ie4uinit.exe" -show'
    Pop $0
  ${ElseIf} ${FileExists} "$SYSDIR\ie4uinit.exe"
    nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
    Pop $0
  ${EndIf}
  Pop $0
!macroend
