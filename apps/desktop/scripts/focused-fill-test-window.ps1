param(
    [Parameter(Mandatory=$true)][string]$StatePath,
    [Parameter(Mandatory=$true)][string]$ValuePath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = [Windows.Forms.Form]::new()
$form.Text = 'CLINVEXA Focused Fill Test'
$form.Width = 720
$form.Height = 260
$form.StartPosition = 'CenterScreen'
$label = [Windows.Forms.Label]::new()
$label.Text = '主诉'
$label.Location = [Drawing.Point]::new(28, 28)
$label.AutoSize = $true
$input = [Windows.Forms.TextBox]::new()
$input.Name = 'chief-complaint'
$input.Multiline = $true
$input.Location = [Drawing.Point]::new(28, 56)
$input.Width = 640
$input.Height = 92
$input.Text = '等待快捷填写'
$input.Add_TextChanged({
    param($sender, $eventArgs)
    [IO.File]::WriteAllText($ValuePath, $sender.Text, [Text.UTF8Encoding]::new($false))
})
$form.Controls.AddRange(@($label, $input))
$form.Add_Shown({
    param($sender, $eventArgs)
    $target = $sender.Controls['chief-complaint']
    $target.Focus()
    $target.SelectAll()
    [IO.File]::WriteAllText($ValuePath, $target.Text, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($StatePath, (@{handle=$sender.Handle.ToInt64(); title=$sender.Text; pid=$PID} | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
})
[void]$form.ShowDialog()
