!macro customInstall
  DetailPrint "Granting Windows sandbox read access to the application directory"
  ExecWait '"$SYSDIR\icacls.exe" "$INSTDIR" /grant *S-1-15-2-1:(OI)(CI)(RX)' $0
  ${if} $0 != 0
    MessageBox MB_ICONSTOP "Unable to grant Windows sandbox access to the installation folder. Home Budgeting may not start."
    Abort
  ${endif}
!macroend
