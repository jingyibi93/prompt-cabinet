Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

appDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
electronCmd = appDir & "\node_modules\.bin\electron.cmd"

shell.CurrentDirectory = appDir
shell.Run "cmd.exe /c cd /d """ & appDir & """ && """ & electronCmd & """ .", 0, False
