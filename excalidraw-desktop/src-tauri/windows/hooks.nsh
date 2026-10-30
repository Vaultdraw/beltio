; NSIS hooks for the Vaultdraw installer (per-user install, no admin rights).
; Puts the install folder on the user's PATH so `vaultdraw` works in any new terminal
; (the command line tool is installed next to the app as vaultdraw.exe), and removes it again on uninstall.
; Only HKCU\Environment\Path is touched; the entry is added once and never duplicated.

Var VdPathAdd

; Rebuilds the user's PATH without the install folder; when $VdPathAdd is 1 it appends the folder again.
!macro VdPathFn PFX
  Function ${PFX}VdPathUpdate
    Push $0
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    Push $R6
    StrCpy $R0 "$INSTDIR"
    ReadRegStr $R1 HKCU "Environment" "Path"
    StrCpy $R1 "$R1;"
    StrCpy $R2 ""
    StrCpy $R3 ""
    StrLen $R6 $R1
    StrCpy $R4 0
    loop:
      IntCmp $R4 $R6 done done +1
      StrCpy $R5 $R1 1 $R4
      IntOp $R4 $R4 + 1
      StrCmp $R5 ";" +3
        StrCpy $R3 "$R3$R5"
        Goto loop
      ; end of one entry: keep it unless it is empty or our folder (NSIS compares without case)
      StrCmp $R3 "" skip
      StrCmp $R3 $R0 skip
      StrCmp $R2 "" +3
        StrCpy $R2 "$R2;$R3"
        Goto skip
      StrCpy $R2 "$R3"
      skip:
      StrCpy $R3 ""
      Goto loop
    done:
    StrCmp $VdPathAdd "1" 0 write
      StrCmp $R2 "" +3
        StrCpy $R2 "$R2;$R0"
        Goto write
      StrCpy $R2 "$R0"
    write:
    WriteRegExpandStr HKCU "Environment" "Path" "$R2"
    ; tell running programs (Explorer, new terminals) that the environment changed
    System::Call 'user32::SendMessageTimeoutW(i 0xffff, i 0x1A, i 0, t "Environment", i 2, i 5000, *i .r0)'
    Pop $R6
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
    Pop $0
  FunctionEnd
!macroend
!insertmacro VdPathFn ""
!insertmacro VdPathFn "un."

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $VdPathAdd "1"
  Call VdPathUpdate
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $VdPathAdd "0"
  Call un.VdPathUpdate
!macroend
