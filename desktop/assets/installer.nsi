; The uninstaller is written on the user's Windows PC. No Wine is needed at build time.
Unicode true
RequestExecutionLevel user
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
Name "WorkSpaceX"
InstallDir "$LOCALAPPDATA\Programs\WorkSpaceX"
InstallDirRegKey HKCU "Software\WorkSpaceX" "InstallPath"
!define MUI_ABORTWARNING
!ifndef MUI_ICON
  !define MUI_ICON "${BUILD_RESOURCES_DIR}\icon.ico"
!endif
!ifndef MUI_UNICON
  !define MUI_UNICON "${BUILD_RESOURCES_DIR}\icon.ico"
!endif
!define MUI_FINISHPAGE_RUN "$INSTDIR\WorkSpaceX.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить WorkSpaceX"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
; P10: пользовательская страница удаления — удалить ли базу, модель и все данные
; в профиле Windows (чекбокс по умолчанию ВКЛ).
UninstPage custom un.PageData un.PageDataLeave
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"

; Переменные: 1 — удалить папку данных ($APPDATA\WorkSpaceX), 0 — сохранить.
Var DeleteAppData
Var UnDataCheckbox

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Требуется Windows x64."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Требуется Windows 10 22H2 или Windows 11."
    Abort
  ${EndIf}
  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  ${If} $0 < 19045
    MessageBox MB_OK|MB_ICONSTOP "Для локального ИИ требуется Windows 10 22H2 (19045) или новее."
    Abort
  ${EndIf}
FunctionEnd

Function .onVerifyInstDir
  IfFileExists "$INSTDIR\WorkSpaceX.exe" valid
  IfFileExists "$INSTDIR\*.*" 0 valid
  Abort
  valid:
FunctionEnd

Function un.PageData
  !insertmacro MUI_HEADER_TEXT "Удаление данных WorkSpaceX" "Выберите, удалить ли базу, модель и все данные в профиле."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateCheckbox} 0 14u 100% 18u "Удалить также базу, модель и все данные (папку WorkSpaceX в профиле)"
  Pop $UnDataCheckbox
  ${NSD_Check} $UnDataCheckbox
  ${NSD_CreateLabel} 0 40u 100% 64u "Будет удалено целиком: $APPDATA\WorkSpaceX — общая база, локальный ИИ (модель qwen2.5vl:3b), личные сейфы, ключи, журналы и настройки.$\r$\n$\r$\nСнимите галочку, если данные нужно сохранить: папку можно удалить позже вручную."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function un.PageDataLeave
  ${NSD_GetState} $UnDataCheckbox $0
  ${If} $0 = ${BST_CHECKED}
    StrCpy $DeleteAppData 1
  ${Else}
    StrCpy $DeleteAppData 0
  ${EndIf}
FunctionEnd

Section "WorkSpaceX" SEC_MAIN
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  ; Only the allowlisted, already-built application is packaged here.
  File /r "${PROJECT_DIR}\release\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\WorkSpaceX"
  CreateShortcut "$SMPROGRAMS\WorkSpaceX\WorkSpaceX.lnk" "$INSTDIR\WorkSpaceX.exe"
  CreateShortcut "$DESKTOP\WorkSpaceX.lnk" "$INSTDIR\WorkSpaceX.exe"
  WriteRegStr HKCU "Software\WorkSpaceX" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkSpaceX" "DisplayName" "WorkSpaceX"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkSpaceX" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkSpaceX" "DisplayIcon" "$INSTDIR\WorkSpaceX.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkSpaceX" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkSpaceX" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkSpaceX" "NoRepair" 1
  ; Кеш иконок Windows мог запомнить прежний (дефолтный) значок по этому пути:
  ; сбрасываем кеш, чтобы ярлыки и панель задач показали иконку из EXE сразу.
  Exec '"$WINDIR\System32\ie4uinit.exe" -show'
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  ; Выбор пользователя с пользовательской страницы удаления (un.PageDataLeave).
  ${If} $DeleteAppData = 1
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Закройте WorkSpaceX перед удалением.$\r$\n$\r$\nБудет удалена и папка данных: $APPDATA\WorkSpaceX (база, модель ИИ, сейфы, ключи, журналы)." IDOK proceed
  ${Else}
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Закройте WorkSpaceX перед удалением.$\r$\n$\r$\nОбщая база, личные сейфы, модель и ключи в профиле Windows будут сохранены." IDOK proceed
  ${EndIf}
  Abort
  proceed:
  ClearErrors
  Delete "$INSTDIR\WorkSpaceX.exe"
  IfErrors 0 closed
  MessageBox MB_OK|MB_ICONSTOP "WorkSpaceX ещё запущен. Завершите его через меню «Программа» и повторите."
  Abort
  closed:
  Delete "$DESKTOP\WorkSpaceX.lnk"
  RMDir /r "$SMPROGRAMS\WorkSpaceX"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkSpaceX"
  DeleteRegKey HKCU "Software\WorkSpaceX"
  ; Только профиль текущего пользователя (SetShellVarContext current);
  ; удаление — по явному выбору на странице удаления.
  ${If} $DeleteAppData = 1
    RMDir /r "$APPDATA\WorkSpaceX"
  ${EndIf}
  RMDir /r "$INSTDIR"
SectionEnd
