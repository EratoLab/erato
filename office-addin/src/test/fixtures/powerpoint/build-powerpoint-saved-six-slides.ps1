# Builds PowerPoint_Saved_Six_Slides.pptx with PowerPoint itself (COM), so the saved file is PowerPoint's own.
# Needs PowerPoint for Windows running; run: powershell -File build-powerpoint-saved-six-slides.ps1 -Out C:\temp\deck.pptx
#   1 title + bullets (indent levels 1-3, a soft line break), notes
#   2 table (a cell with a line break)
#   3 chart: dates as categories, a percentage series, notes
#   4 SmartArt (AddNode(2) adds a node after, not below, so all nodes are on level 1)
#   5 group (a nested group) + picture, hidden
#   6 layout slide: two columns told apart only by position, an empty title placeholder
# COM NumberFormat follows the Windows locale: the checked-in deck came from a German Windows, where
# '0.0%' was saved as '#,#00%'. The deck's author is the account that ran the script.
param(
  [Parameter(Mandatory)] [string] $Out,
  [string] $Picture = (Join-Path $PSScriptRoot '..\..\..\..\public\assets\color-icon-192x192.png')
)
$ErrorActionPreference = 'Stop'
$app = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
$p = $app.Presentations.Add()
$vt = [char]11

# 1: ppLayoutText = 2
$s1 = $p.Slides.Add(1, 2)
$s1.Shapes.Item(1).TextFrame.TextRange.Text = 'Quarterly review'
$body = $s1.Shapes.Item(2).TextFrame.TextRange
$body.Text = "Revenue grew in every region`rEurope${vt}led by Germany`rNew customers`rEnterprise`rMid-market`rRisks ahead"
$body.Paragraphs(2).IndentLevel = 2
$body.Paragraphs(4).IndentLevel = 2
$body.Paragraphs(5).IndentLevel = 3
$s1.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = "Open with the numbers.`rThen ask for questions."

# 2: ppLayoutTitleOnly = 11
$s2 = $p.Slides.Add(2, 11)
$s2.Shapes.Item(1).TextFrame.TextRange.Text = 'Regional figures'
$t = $s2.Shapes.AddTable(3, 3, 60, 140, 600, 150).Table
$cells = @(@('Region', 'Revenue', 'Change'), @('Europe', '1,240', "+12%${vt}(best)"), @('Asia', '980', '-3%'))
for ($r = 0; $r -lt 3; $r++) { for ($c = 0; $c -lt 3; $c++) { $t.Cell($r + 1, $c + 1).Shape.TextFrame.TextRange.Text = $cells[$r][$c] } }

# 3: chart, xlLineMarkers = 65
$s3 = $p.Slides.Add(3, 11)
$s3.Shapes.Item(1).TextFrame.TextRange.Text = 'Conversion rate'
$chart = $s3.Shapes.AddChart2(-1, 65, 60, 120, 600, 330).Chart
$chart.ChartData.Activate()
$wb = $chart.ChartData.Workbook
$ws = $wb.Worksheets.Item(1)
$ws.Range('A1:D6').ClearContents()
$ws.Range('A1').Value2 = 'Month'
$ws.Range('B1').Value2 = 'Conversion'
$dates = @('2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01')
$rates = @(0.12, 0.155, 0.18, 0.205)
for ($i = 0; $i -lt 4; $i++) {
  $ws.Cells.Item($i + 2, 1).Value2 = ([datetime]$dates[$i]).ToOADate()
  $ws.Cells.Item($i + 2, 2).Value2 = $rates[$i]
}
$ws.Range('A2:A5').NumberFormat = 'mmm yyyy'
$ws.Range('B2:B5').NumberFormat = '0.0%'
$chart.SetSourceData("='" + $ws.Name + "'!`$A`$1:`$B`$5")
$chart.HasTitle = $true
$chart.ChartTitle.Text = 'Conversion rate 2026'
$wb.Close()
$s3.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = 'April is the record month.'

# 4: SmartArt, basic block list = layout 1
$s4 = $p.Slides.Add(4, 11)
$s4.Shapes.Item(1).TextFrame.TextRange.Text = 'Project phases'
$art = $s4.Shapes.AddSmartArt($app.SmartArtLayouts.Item(1), 60, 130, 600, 300).SmartArt
while ($art.AllNodes.Count -gt 0) { $art.AllNodes.Item(1).Delete() }
foreach ($name in @('Plan', 'Build', 'Launch')) {
  $node = $art.AllNodes.Add()
  $node.TextFrame2.TextRange.Text = $name
}
$sub = $art.AllNodes.Item(2).AddNode(2)
$sub.TextFrame2.TextRange.Text = 'Pilot with two teams'

# 5: group with a nested group, picture, hidden
$s5 = $p.Slides.Add(5, 11)
$s5.Shapes.Item(1).TextFrame.TextRange.Text = 'Team'
$a = $s5.Shapes.AddShape(1, 60, 140, 160, 60); $a.TextFrame.TextRange.Text = 'Lead'; $a.Name = 'Lead box'
$b = $s5.Shapes.AddShape(1, 60, 220, 160, 60); $b.TextFrame.TextRange.Text = 'Engineer'; $b.Name = 'Engineer box'
$c = $s5.Shapes.AddShape(1, 240, 220, 160, 60); $c.TextFrame.TextRange.Text = 'Designer'; $c.Name = 'Designer box'
$inner = $s5.Shapes.Range([object[]]@('Engineer box', 'Designer box')).Group(); $inner.Name = 'Members'
$outer = $s5.Shapes.Range([object[]]@('Lead box', 'Members')).Group(); $outer.Name = 'Org chart'
$pic = $s5.Shapes.AddPicture((Resolve-Path $Picture).Path, 0, -1, 480, 140, 120, 120); $pic.Name = 'Logo'
$pic.AlternativeText = 'Company logo'
$s5.SlideShowTransition.Hidden = -1

# 6: ppLayoutTwoColumnText = 3, title left empty
$s6 = $p.Slides.Add(6, 3)
$s6.Shapes.Item(2).TextFrame.TextRange.Text = "Keep`rWeekly sync`rShared roadmap"
$s6.Shapes.Item(3).TextFrame.TextRange.Text = "Drop`rMonthly report`rManual exports"

$p.SaveAs($Out)
'built: ' + $Out + ' slides=' + $p.Slides.Count
