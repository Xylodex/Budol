$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'extension/icons'
New-Item -ItemType Directory -Path $iconRoot -Force | Out-Null
foreach ($size in @(16, 32, 48, 128)) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform(($size / 128.0), ($size / 128.0))
    $background = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#165c9c'))
    $foreground = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#e8f7ff'))
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, 36, 36, 180, 90)
    $path.AddArc(92, 0, 36, 36, 270, 90)
    $path.AddArc(92, 92, 36, 36, 0, 90)
    $path.AddArc(0, 92, 36, 36, 90, 90)
    $path.CloseFigure()
    $graphics.FillPath($background, $path)
    # A geometric B stays crisp at toolbar sizes without relying on installed fonts.
    $letter = New-Object System.Drawing.Drawing2D.GraphicsPath
    $letter.AddLine(35, 27, 65, 27)
    $letter.AddBezier(65, 27, 96, 27, 99, 56, 79, 62)
    $letter.AddBezier(79, 62, 104, 68, 100, 101, 66, 101)
    $letter.AddLine(66, 101, 35, 101)
    $letter.CloseFigure()
    $graphics.FillPath($foreground, $letter)
    $graphics.FillEllipse($background, 51, 41, 24, 16)
    $graphics.FillEllipse($background, 51, 71, 27, 16)
    $bitmap.Save((Join-Path $iconRoot "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $letter.Dispose()
    $path.Dispose()
    $foreground.Dispose()
    $background.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
