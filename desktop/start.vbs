Option Explicit
Dim fso, shell, root, file, version, script, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
Set file = fso.OpenTextFile(fso.BuildPath(root, "current-version.txt"), 1)
version = Trim(file.ReadAll)
file.Close
If Len(version) < 1 Or InStr(version, "..") > 0 Or InStr(version, "\") > 0 Or InStr(version, "/") > 0 Then
  MsgBox "The installed version pointer is invalid.", 16, "Dideban"
  WScript.Quit 1
End If
script = fso.BuildPath(root, "versions\" & version & "\desktop\tray.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """"
shell.Run command, 0, False
