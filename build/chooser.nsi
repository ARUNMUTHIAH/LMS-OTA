; One setup exe for both libraries: asks which software to install, then runs that software's own
; installer (the normal Technical or General Library install wizard, unchanged).
; Built by scripts/build-all.js (npm run dist:all), which passes:
;   TECH_SETUP, GENERAL_SETUP  the two installers made by npm run dist / npm run dist:general
;   OUT                        the setup exe to write
;   ICON                       the app icon
;   VERSION                    x.y.z, shown in the exe's properties
; Nothing is selected by default: the person must choose one before Next is enabled.
; Silent install (IT): "<setup>.exe" /EDITION=general /S   (or /EDITION=technical); /S alone does nothing.

Unicode true
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define PRODUCT "2CQR GARUDA"
!define TECH_NAME "Technical Library"
!define GENERAL_NAME "General Library"

Name "${PRODUCT}"
Caption "${PRODUCT} Setup"
OutFile "${OUT}"
RequestExecutionLevel user ; the inner installers install per user, as before
SetCompress off ; the inner installers are already compressed
ShowInstDetails nevershow
BrandingText "${PRODUCT}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT}"
VIAddVersionKey "FileDescription" "${PRODUCT} Setup"
VIAddVersionKey "CompanyName" "2CQR"
VIAddVersionKey "LegalCopyright" "(c) 2026 2CQR"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

!define MUI_ICON "${ICON}"
; The 2CQR GARUDA eagle at the top right of the page, as in the app installers.
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${__FILEDIR__}\installerHeader.bmp"

Var Dialog
Var RadioTech
Var RadioGeneral
Var Edition ; technical | general | "" (not chosen yet: nothing is selected by default)

Page custom ChoosePage ChoosePageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  StrCpy $Edition ""
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/EDITION=" $1
  ${IfNot} ${Errors}
    ${If} $1 == "general"
    ${OrIf} $1 == "technical"
      StrCpy $Edition $1
    ${EndIf}
  ${EndIf}
  ; A silent install has nobody to choose: it needs /EDITION=technical or /EDITION=general.
  ${If} ${Silent}
  ${AndIf} $Edition == ""
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd

; A click on either option: tick it, untick the other, and enable Next (disabled until then).
; The options are plain radio buttons, ticked only here: an automatic one would tick itself as
; soon as the page opens and the focus lands on it.
Function OnChoice
  Pop $1 ; the option clicked
  ${If} $1 == $RadioGeneral
    ${NSD_Check} $RadioGeneral
    ${NSD_Uncheck} $RadioTech
  ${Else}
    ${NSD_Check} $RadioTech
    ${NSD_Uncheck} $RadioGeneral
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1
  EnableWindow $0 1
FunctionEnd

Function ChoosePage
  !insertmacro MUI_HEADER_TEXT "Choose software" "Select which software to install on this computer."
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 14u "Which software do you want to install?"
  Pop $0

  ${NSD_CreateRadioButton} 8u 22u 100% 12u "${TECH_NAME}"
  Pop $RadioTech
  ${NSD_CreateLabel} 22u 35u 90% 12u "For technical manuals (LF and CAT fields)."
  Pop $0

  ${NSD_CreateRadioButton} 8u 56u 100% 12u "${GENERAL_NAME}"
  Pop $RadioGeneral
  ${NSD_CreateLabel} 22u 69u 90% 12u "For general books (Title and Author fields)."
  Pop $0

  ${NSD_CreateLabel} 0 98u 100% 24u "Click Next to continue with the setup of the selected software. Each software keeps its own license and data."
  Pop $0

  ; Plain (not automatic) radio buttons: nothing gets ticked unless the person clicks it.
  SendMessage $RadioTech ${BM_SETSTYLE} ${BS_RADIOBUTTON} 0
  SendMessage $RadioGeneral ${BM_SETSTYLE} ${BS_RADIOBUTTON} 0
  ${NSD_OnClick} $RadioTech OnChoice
  ${NSD_OnClick} $RadioGeneral OnChoice
  ; "Next >" rather than "Install": the chosen software's own wizard does the installing.
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$(^NextBtn)"
  ; Nothing selected by default; coming back to this page keeps the earlier choice.
  ${If} $Edition == "general"
    ${NSD_Check} $RadioGeneral
  ${ElseIf} $Edition == "technical"
    ${NSD_Check} $RadioTech
  ${Else}
    GetDlgItem $0 $HWNDPARENT 1
    EnableWindow $0 0
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function ChoosePageLeave
  ${NSD_GetState} $RadioGeneral $0
  ${NSD_GetState} $RadioTech $1
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Edition "general"
  ${ElseIf} $1 == ${BST_CHECKED}
    StrCpy $Edition "technical"
  ${Else}
    MessageBox MB_ICONEXCLAMATION|MB_OK "Please select which software to install."
    Abort ; stay on this page
  ${EndIf}
FunctionEnd

Section "Install"
  SetAutoClose true
  InitPluginsDir ; temporary folder, removed when this setup closes
  ${If} $Edition == "general"
    File "/oname=$PLUGINSDIR\setup.exe" "${GENERAL_SETUP}"
  ${Else}
    File "/oname=$PLUGINSDIR\setup.exe" "${TECH_SETUP}"
  ${EndIf}
  ; The chosen software's own install wizard takes over from here.
  HideWindow
  ${If} ${Silent}
    ExecWait '"$PLUGINSDIR\setup.exe" /S' $0
  ${Else}
    ExecWait '"$PLUGINSDIR\setup.exe"' $0
  ${EndIf}
  SetErrorLevel $0
SectionEnd
