Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!ifndef VERSION
  !error "VERSION is required"
!endif
!ifndef PAYLOAD
  !error "PAYLOAD is required"
!endif
!ifndef OUTPUT
  !error "OUTPUT is required"
!endif
Name "Dideban ${VERSION}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Dideban"
InstallDirRegKey HKCU "Software\Dideban" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Dideban Newsroom"
VIAddVersionKey "FileDescription" "Dideban per-user Windows installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Dideban project contributors"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\start.vbs"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchDideban
!define MUI_FINISHPAGE_RUN_TEXT "اجرای دیدبان کنار ساعت ویندوز"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Farsi"
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetRegView 64
  checkRunning:
    System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\DidebanNewsroomTray") p .r0 ?e'
    Pop $1
    System::Call 'kernel32::CloseHandle(p r0)'
    ${If} $1 = 183
      MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "دیدبان در حال اجراست. از آیکون کنار ساعت، Quit Dideban را بزنید و سپس Retry را انتخاب کنید." IDRETRY checkRunning
      Abort
    ${EndIf}
FunctionEnd

Section "Dideban"
  SetShellVarContext current
  SetOutPath "$INSTDIR\versions\${VERSION}"
  File /r "${PAYLOAD}\*.*"
  FileOpen $0 "$INSTDIR\versions\${VERSION}\.dideban-version" w
  FileWrite $0 "${VERSION}"
  FileClose $0
  SetOutPath "$INSTDIR"
  File "start.vbs"
  FileOpen $0 "$INSTDIR\current-version.txt" w
  FileWrite $0 "${VERSION}"
  FileClose $0
  WriteRegStr HKCU "Software\Dideban" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dideban" "DisplayName" "Dideban Newsroom"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dideban" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dideban" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dideban" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dideban" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dideban" "NoRepair" 1
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Dideban"
  CreateShortCut "$SMPROGRAMS\Dideban\Dideban.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\start.vbs"'
  CreateShortCut "$DESKTOP\Dideban.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\start.vbs"'
SectionEnd

Function LaunchDideban
  ExecShell "open" "$INSTDIR\start.vbs"
FunctionEnd

Function .onInstSuccess
  IfSilent 0 done
    ExecShell "open" "$INSTDIR\start.vbs"
  done:
FunctionEnd

Function un.onInit
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\DidebanNewsroomTray") p .r0 ?e'
  Pop $1
  System::Call 'kernel32::CloseHandle(p r0)'
  StrCmp $1 183 0 done
    MessageBox MB_OK "Close Dideban from its tray menu before uninstalling."
    Abort
  done:
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Dideban.lnk"
  Delete "$SMPROGRAMS\Dideban\Dideban.lnk"
  RMDir "$SMPROGRAMS\Dideban"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Dideban"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dideban"
  DeleteRegKey HKCU "Software\Dideban"
  FindFirst $0 $1 "$INSTDIR\versions\*"
  version_loop:
    StrCmp $1 "" version_done
    IfFileExists "$INSTDIR\versions\$1\.dideban-version" 0 next_version
    RMDir /r "$INSTDIR\versions\$1"
  next_version:
    FindNext $0 $1
    Goto version_loop
  version_done:
    FindClose $0
    RMDir "$INSTDIR\versions"
  Delete "$INSTDIR\start.vbs"
  Delete "$INSTDIR\current-version.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  ; User news and credentials in LOCALAPPDATA\Dideban are deliberately retained.
SectionEnd
