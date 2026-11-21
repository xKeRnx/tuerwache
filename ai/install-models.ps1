$ErrorActionPreference = 'Stop'
$modelRoot = Join-Path $PSScriptRoot 'models'
New-Item -ItemType Directory -Force -Path $modelRoot | Out-Null
$revision = '48b10fa505aeb51fbd127fc60a5c660040e823b7'
$models = @{
    yunet = 'face_detection_yunet/face_detection_yunet_2023mar.onnx'
    sface = 'face_recognition_sface/face_recognition_sface_2021dec.onnx'
    yolox = 'object_detection_yolox/object_detection_yolox_2022nov.onnx'
}
$manifest = @()
foreach ($name in $models.Keys) {
    $relative = $models[$name]
    $url = "https://media.githubusercontent.com/media/opencv/opencv_zoo/$revision/models/$relative"
    $target = Join-Path $modelRoot "$name.onnx"
    $pointer = Invoke-RestMethod -Uri "https://raw.githubusercontent.com/opencv/opencv_zoo/$revision/models/$relative"
    $expectedHash = [regex]::Match([string]$pointer, 'oid sha256:([a-f0-9]{64})').Groups[1].Value
    if (-not $expectedHash) { throw 'Modell-Hash fehlt im offiziellen LFS-Zeiger.' }
    if (-not (Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower() -ne $expectedHash) {
        Invoke-WebRequest -Uri $url -OutFile "$target.download"
        if ((Get-FileHash -LiteralPath "$target.download" -Algorithm SHA256).Hash.ToLower() -ne $expectedHash) { throw "Hashprüfung fehlgeschlagen: $name" }
        Move-Item -LiteralPath "$target.download" -Destination $target -Force
    }
    $folder = $relative.Split('/')[0]
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/opencv/opencv_zoo/$revision/models/$folder/LICENSE" -OutFile (Join-Path $modelRoot "$name-LICENSE")
    $manifest += @{ name=$name; source=$url; sha256=$expectedHash; revision=$revision }
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $modelRoot 'manifest.json') -Encoding utf8
Write-Output 'Lokale KI-Modelle heruntergeladen und SHA-256 geprüft.'
