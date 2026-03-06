Add-Type -AssemblyName System.Drawing

function New-WeaverIcon {
    param([string]$OutPath, [int]$Size)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::FromArgb(13,13,26))

    $pad = [int]($Size * 0.08)
    $gap = [int]([Math]::Max(3, $Size * 0.04))
    $bs  = [int](($Size - $pad*2 - $gap) / 2)
    $cr  = [int]([Math]::Max(4, $bs * 0.18))
    $hlh = [int]($bs * 0.30)

    # 4 blocks with explicit coords
    $blocks = @(
        @{ x=$pad;          y=$pad;          r=167; green=139; b=250 },  # violet
        @{ x=$pad+$bs+$gap; y=$pad;          r=96;  green=165; b=250 },  # blue
        @{ x=$pad;          y=$pad+$bs+$gap; r=52;  green=211; b=153 },  # green
        @{ x=$pad+$bs+$gap; y=$pad+$bs+$gap; r=245; green=158; b=11  }   # amber
    )

    foreach ($blk in $blocks) {
        $x = $blk.x; $y = $blk.y
        $color  = [System.Drawing.Color]::FromArgb($blk.r, $blk.green, $blk.b)
        $brush  = New-Object System.Drawing.SolidBrush($color)

        $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
        $gp.AddArc($x,           $y,           $cr*2, $cr*2, 180, 90)
        $gp.AddArc($x+$bs-$cr*2, $y,           $cr*2, $cr*2, 270, 90)
        $gp.AddArc($x+$bs-$cr*2, $y+$bs-$cr*2, $cr*2, $cr*2,   0, 90)
        $gp.AddArc($x,           $y+$bs-$cr*2, $cr*2, $cr*2,  90, 90)
        $gp.CloseFigure()
        $g.FillPath($brush, $gp)
        $brush.Dispose(); $gp.Dispose()

        # Top highlight
        $hlBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(55,255,255,255))
        $hp = New-Object System.Drawing.Drawing2D.GraphicsPath
        $hp.AddArc($x,           $y, $cr*2, $cr*2, 180, 90)
        $hp.AddArc($x+$bs-$cr*2, $y, $cr*2, $cr*2, 270, 90)
        $hp.AddLine($x+$bs, $y+$cr,  $x+$bs, $y+$hlh)
        $hp.AddLine($x+$bs, $y+$hlh, $x,     $y+$hlh)
        $hp.CloseFigure()
        $g.FillPath($hlBrush, $hp)
        $hlBrush.Dispose(); $hp.Dispose()
    }

    $g.Dispose()
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "OK $OutPath"
}

$base = 'android\app\src\main\res'
@(
    @{ folder='mipmap-mdpi';    size=48  },
    @{ folder='mipmap-hdpi';    size=72  },
    @{ folder='mipmap-xhdpi';   size=96  },
    @{ folder='mipmap-xxhdpi';  size=144 },
    @{ folder='mipmap-xxxhdpi'; size=192 }
) | ForEach-Object {
    $dir = Join-Path $base $_.folder
    New-WeaverIcon (Join-Path $dir 'ic_launcher.png')            $_.size
    New-WeaverIcon (Join-Path $dir 'ic_launcher_round.png')      $_.size
    New-WeaverIcon (Join-Path $dir 'ic_launcher_foreground.png') $_.size
}
Write-Host "All icons done."
