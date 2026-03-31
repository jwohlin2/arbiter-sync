' Arbiter Sync Launcher
' Double-click this file to start the app.

Dim fso, scriptDir, WshShell, nodePath

Set fso      = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodePath  = "C:\Program Files\nodejs\node.exe"

' Check Node.js is installed
If Not fso.FileExists(nodePath) Then
  MsgBox "Node.js not found. Please install it from https://nodejs.org (LTS version).", _
         vbCritical, "Arbiter Sync"
  WScript.Quit
End If

' Check if server is already running — if so, just open the browser
Dim http
Set http = CreateObject("MSXML2.XMLHTTP")
On Error Resume Next
http.Open "GET", "http://localhost:3000", False
http.Send
If Err.Number = 0 And http.Status = 200 Then
  WshShell.Run "http://localhost:3000"
  WScript.Quit
End If
On Error GoTo 0

' Start the server (hidden window)
WshShell.Run "cmd /c cd /d """ & scriptDir & """ && """ & nodePath & """ server.js", 0, False

' Wait for it to start, then open browser
WScript.Sleep 2500
WshShell.Run "http://localhost:3000"
