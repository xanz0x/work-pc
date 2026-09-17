$msi = 'C:\Users\admin-pc\Desktop\HERMES\work-pc-main\desktop\assets\tailscale\tailscale-setup-1.102.4-amd64.msi'
$sig = Get-AuthenticodeSignature -FilePath $msi
Write-Output ("Status: " + $sig.Status)
Write-Output ("Signer: " + $sig.SignerCertificate.Subject)
$exe = 'C:\Users\admin-pc\Desktop\HERMES\work-pc-main\desktop\release\WorkSpaceX-Setup-1.1.0-x64.exe'
if (Test-Path $exe) { Write-Output ("Setup exists: " + ((Get-Item $exe).Length) + " bytes") }
