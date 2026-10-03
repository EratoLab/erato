# Offline regression checks. No Azure account, network or Pester installation needed.
# Run: pwsh -NoProfile -File scripts/teams-bot/Test-EratoTeamsSetup.ps1
$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot '../../../site/public/setup/teams/1.0.1/EratoTeamsSetup.ps1'
$base = @{ TenantId = '11111111-1111-1111-1111-111111111111'; SubscriptionId = '22222222-2222-2222-2222-222222222222'
    BotAppId = '33333333-3333-3333-3333-333333333333'; AuthAppId = '44444444-4444-4444-4444-444444444444'; BaseUrl = 'https://erato.example.com' }
. $helper @base
$realAz = (Get-Command Invoke-EratoAz).ScriptBlock
$script:passed = 0

function Assert-True($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Assert-Throws($Action, $Pattern) {
    try { & $Action } catch { Assert-True ($_.Exception.Message -match $Pattern) "Unexpected error: $($_.Exception.Message)"; return }
    throw "Expected an error matching $Pattern"
}
function Reset-Fixture {
    $script:settings = $base.Clone()
    $settings.CurrentConnection = 'graph'; $settings.ConnectionName = 'graph-sso'
    $settings.SsoResource = "api://erato.example.com/botid-$($base.BotAppId)"
    $script:calls = [Collections.Generic.List[object]]::new()
    $script:writes = [Collections.Generic.List[object]]::new()
    $script:app = @{ id = 'app-object'; appId = $base.AuthAppId; displayName = 'Existing add-in'; signInAudience = 'AzureADMyOrg'
        identifierUris = @('api://existing-app'); api = @{ requestedAccessTokenVersion = 1; oauth2PermissionScopes = @(@{ id = 'old-scope'; value = 'old'; isEnabled = $true }); preAuthorizedApplications = @(@{ appId = 'old-client'; delegatedPermissionIds = @('old-scope') }) }
        web = @{ redirectUris = @('https://existing.example.com/callback'); implicitGrantSettings = @{ enableIdTokenIssuance = $true }; redirectUriSettings = @('read-only-field') }
        spa = @{ redirectUris = @('brk-multihub://erato.example.com') }; requiredResourceAccess = @(@{ resourceAppId = 'other-api'; resourceAccess = @(@{ id = 'old-role'; type = 'Role' }) }) }
    $script:bot = @{ id = "/subscriptions/$($base.SubscriptionId)/resourceGroups/customer/providers/Microsoft.BotService/botServices/customer-bot"; name = 'customer-bot'; location = 'global'
        properties = @{ msaAppId = $base.BotAppId; msaAppTenantId = $base.TenantId; msaAppType = 'SingleTenant'; endpoint = "$($base.BaseUrl)/api/integrations/ms_teams/messages"; enabledChannels = @('msteams') } }
    $script:connection = $null; $script:wrongTenant = $false; $script:denyConsent = $false; $script:failConnection = $false
    $script:duplicateBot = $false; $script:nextLink = $null; $script:scopePage = 0; $script:failPreauthorization = $false
    $script:failRepair = $false
}

function Invoke-EratoAz {
    param([string[]]$Arguments)
    $script:calls.Add($Arguments)
    if ($Arguments[0] -eq 'account') { return @{ tenantId = $(if ($script:wrongTenant) { 'wrong-tenant' } else { $base.TenantId }); id = $base.SubscriptionId; environmentName = 'AzureCloud' } }
    $url = $Arguments[[array]::IndexOf($Arguments, '--url') + 1]
    $method = $Arguments[[array]::IndexOf($Arguments, '--method') + 1]
    if ($method -ne 'GET') {
        $bodyFile = $Arguments[[array]::IndexOf($Arguments, '--body') + 1]
        Assert-True ($bodyFile.StartsWith('@')) 'Request body must be passed by file, never inline'
        $body = Get-Content $bodyFile.Substring(1) -Raw | ConvertFrom-Json -AsHashtable
        if (-not $IsWindows) {
            $mode = if ($IsMacOS) { & stat -f '%Lp' (Split-Path $bodyFile.Substring(1)) } else { & stat -c '%a' (Split-Path $bodyFile.Substring(1)) }
            Assert-True ($mode -eq '700') 'Request directory must be private'
        }
        $script:writes.Add(@{ method = $method; url = $url; body = $body; file = $bodyFile.Substring(1) })
        if ($method -eq 'PATCH' -and $url -match '/connections/') {
            if ($script:failRepair) { throw 'Azure request failed (RequestFailed).' }
            Assert-True ($body.properties.Keys.Count -eq 1 -and $body.properties.ContainsKey('parameters')) 'Repair must not replace credentials or other connection properties'
            $script:connection.properties.parameters = $body.properties.parameters
            return $script:connection
        }
        if ($method -eq 'PATCH') {
            # Live Graph rejects a pre-authorization that references a scope
            # introduced in this same request: the scope must already exist.
            foreach ($client in $body.api.preAuthorizedApplications) {
                foreach ($id in $client.delegatedPermissionIds) {
                    Assert-True ($id -in $script:app.api.oauth2PermissionScopes.id) 'Graph rejected a pre-authorization for a scope not yet saved'
                }
                if ($script:failPreauthorization -and $client.appId -in $script:TeamsClients) { throw 'Azure request failed (RequestFailed).' }
            }
            foreach ($key in $body.Keys) { $script:app[$key] = $body[$key] }
            return @{}
        }
        if ($url.EndsWith('/addPassword')) { return @{ keyId = 'credential-key-id'; secretText = 'DO-NOT-PRINT-THIS-SECRET' } }
        if ($method -eq 'PUT') {
            if ($script:failConnection) { throw 'Azure request failed (RequestFailed). Raw responses withheld.' }
            Assert-True ($body.properties.clientSecret -ceq 'DO-NOT-PRINT-THIS-SECRET') 'Credential must be passed to OAuth connection'
            $body.properties.Remove('clientSecret')
            $script:connection = @{ name = 'graph-sso'; properties = $body.properties }; return $script:connection
        }
        throw 'Unexpected mutation'
    }
    if ($url -match '/providers/Microsoft.BotService/botServices\?') {
        return @{ value = $(if ($script:duplicateBot) { @($script:bot, $script:bot) } else { @($script:bot) }) }
    }
    if ($url -match '/botServices/customer-bot\?') { return $script:bot }
    if ($url -match '/connections/') { if (-not $script:connection) { throw 'Azure request failed (NotFound).' }; return $script:connection }
    if ($url -match '/applications\(appId=') { return $script:app }
    if ($url -match '/oauth2PermissionGrants') {
        if ($script:denyConsent) { throw 'Azure request failed (AccessDenied).' }
        return @{ value = @(@{ consentType = 'AllPrincipals'; resourceId = 'graph-sp'; scope = $script:Scopes -join ' ' }) }
    }
    if ($url -match '/servicePrincipals') {
        if ($url -match [regex]::Escape($script:GraphAppId)) {
            return @{ value = @(@{ id = 'graph-sp'; oauth2PermissionScopes = @($script:Scopes | ForEach-Object { @{ id = "id-$_"; value = $_; isEnabled = $true } }) }) }
        }
        return @{ value = @(@{ id = 'auth-sp' }) }
    }
    throw "Unexpected mock request: $method $url"
}

function Test-Case($Name, $Action) {
    Reset-Fixture
    & $Action
    $script:passed++
    Write-Host "PASS $Name"
}

Test-Case 'default resource uses the bot ID with a separate authentication app' {
    $settings.Remove('SsoResource')
    $report = Invoke-EratoSetup -Settings $settings -Json
    Assert-True ($settings.SsoResource -ceq "api://erato.example.com/botid-$($base.BotAppId)") 'Default resource used the authentication app ID'
    Assert-True ($report.authAppId -eq $base.AuthAppId -and $writes.Count -eq 0) 'Authentication identity changed'
    Assert-True ($report.version -eq '1.0.1') 'Report version does not match the helper release'
}
Test-Case 'authentication app ID in resource is rejected before Azure access' {
    $settings.SsoResource = "api://erato.example.com/botid-$($base.AuthAppId)"
    Assert-Throws { Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json } 'botid-<BotAppId>'
    Assert-True ($calls.Count -eq 0 -and $writes.Count -eq 0) 'Invalid resource reached Azure'
}
Test-Case 'standalone bot resource remains supported' {
    $settings.SsoResource = "api://botid-$($base.BotAppId)"
    $report = Invoke-EratoSetup -Settings $settings -Json
    Assert-True ($report.mode -eq 'Check' -and $writes.Count -eq 0) 'Standalone resource rejected'
}
Test-Case 'default check performs no writes and reports missing SSO' {
    $report = Invoke-EratoSetup -Settings $settings -Json
    Assert-True ($writes.Count -eq 0 -and $report.mode -eq 'Check' -and $report.exitCode -eq 1) 'Default must be read-only'
    Assert-True ($report.note -match 'No cloud settings') 'Check must distinguish configuration from end-to-end SSO'
}
Test-Case 'WhatIf and Apply WhatIf never create credentials or connections' {
    $report = Invoke-EratoSetup -Settings $settings -WhatIf -Json
    $report2 = Invoke-EratoSetup -Settings $settings -Apply -WhatIf -Json
    Assert-True ($writes.Count -eq 0 -and $report.plan.createConnection -and $report2.mode -eq 'Preview') 'Preview mutated Azure'
}
Test-Case 'wrong tenant fails before resource reads or writes' {
    $script:wrongTenant = $true
    Assert-Throws { Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json } 'Wrong Azure CLI tenant'
    Assert-True ($calls.Count -eq 2 -and $writes.Count -eq 0) 'Wrong tenant accessed resources'
}
Test-Case 'ambiguous discovery requires an explicit resource selection' {
    $script:duplicateBot = $true
    Assert-Throws { Invoke-EratoSetup -Settings $settings -Json } '2 matching bots'
}
Test-Case 'resource-scoped checks avoid subscription-wide bot enumeration' {
    $settings.ResourceGroup = 'customer'; $settings.BotName = 'customer-bot'
    $report = Invoke-EratoSetup -Settings $settings -Json
    Assert-True ($report.botName -eq 'customer-bot') 'Did not resolve the selected resource'
    Assert-True (-not (($calls | ForEach-Object { $_ -join ' ' }) -match '/providers/Microsoft.BotService/botServices\?')) 'Enumerated the subscription despite an explicit resource'
}
Test-Case 'unreadable consent blocks Apply rather than claiming a missing setting' {
    $script:denyConsent = $true
    Assert-Throws { Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json } 'AccessDenied'
    Assert-True ($writes.Count -eq 0) 'Apply proceeded after an incomplete audit'
}
Test-Case 'bot tenant, channel and endpoint must agree before Apply' {
    foreach ($field in @('msaAppTenantId', 'msaAppType', 'endpoint', 'enabledChannels')) {
        $old = $bot.properties[$field]; $bot.properties[$field] = 'incorrect'
        Assert-Throws { Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json } 'Resolve the bot'
        $bot.properties[$field] = $old
    }
    Assert-True ($writes.Count -eq 0) 'Invalid bot allowed mutation'
}
Test-Case 'conflicting or current OAuth connections are preserved' {
    $script:connection = @{ properties = @{ clientId = 'another-app' } }
    Assert-Throws { Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json } 'different settings'
    $settings.ConnectionName = 'graph'
    Assert-Throws { Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json } 'separate SSO connection'
    Assert-True ($writes.Count -eq 0) 'Existing connection was overwritten'
}
Test-Case 'plan preserves existing API settings, permissions and all tab redirects' {
    $before = $app | ConvertTo-Json -Depth 50 -Compress
    $audit = Get-EratoAudit $settings; $plan = New-EratoSsoPlan $audit $settings
    Assert-True (($app | ConvertTo-Json -Depth 50 -Compress) -ceq $before) 'Planning changed the input app'
    Assert-True ('api://existing-app' -in $plan.applicationPatch.identifierUris) 'Lost existing URI'
    Assert-True ('old-scope' -in $plan.applicationPatch.api.oauth2PermissionScopes.id) 'Lost existing scope'
    Assert-True ('old-client' -in $plan.applicationPatch.api.preAuthorizedApplications.appId) 'Lost existing client'
    Assert-True ('https://existing.example.com/callback' -in $plan.applicationPatch.web.redirectUris) 'Lost existing redirect'
    Assert-True ($plan.applicationPatch.web.implicitGrantSettings.enableIdTokenIssuance) 'Lost implicit grant setting'
    Assert-True (-not $plan.applicationPatch.web.ContainsKey('redirectUriSettings')) 'Included read-only Graph field'
    Assert-True (-not $plan.applicationPatch.ContainsKey('spa')) 'Changed tab redirects'
    Assert-True ('other-api' -in $plan.applicationPatch.requiredResourceAccess.resourceAppId) 'Lost unrelated API permissions'
}
Test-Case 'empty optional app fields produce arrays without null entries' {
    $app.api = $null; $app.web = $null; $app.requiredResourceAccess = $null; $app.identifierUris = $null
    $plan = New-EratoSsoPlan (Get-EratoAudit $settings) $settings
    $json = $plan.applicationPatch | ConvertTo-Json -Depth 50 -Compress
    Assert-True ($json -notmatch '\[null|null,|,null') 'Generated arrays contain null entries'
}
Test-Case 'existing disabled access_as_user is enabled without replacing its ID' {
    $app.api.oauth2PermissionScopes += @{ id = 'existing-sso-id'; value = 'access_as_user'; isEnabled = $false }
    $plan = New-EratoSsoPlan (Get-EratoAudit $settings) $settings
    $scope = $plan.applicationPatch.api.oauth2PermissionScopes | Where-Object value -eq 'access_as_user'
    Assert-True ($scope.id -eq 'existing-sso-id' -and $scope.isEnabled) 'Replaced existing scope'
}
Test-Case 'Apply creates a separate credential, verifies writes and is idempotent' {
    $report = Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json
    Assert-True ($writes.Count -eq 4 -and $report.mode -eq 'Apply') 'Expected scope patch, app patch, credential, connection'
    $persistedScope = $writes[0].body.api.oauth2PermissionScopes | Where-Object value -eq 'access_as_user'
    Assert-True ($persistedScope.id -in $writes[1].body.api.preAuthorizedApplications.delegatedPermissionIds) 'Pre-authorization did not use the persisted scope ID'
    Assert-True ('old-client' -in $writes[0].body.api.preAuthorizedApplications.appId) 'Scope creation lost an existing client'
    Assert-True ($report.credential.keyId -eq 'credential-key-id') 'Credential metadata missing'
    Assert-True (($report | ConvertTo-Json -Depth 50) -notmatch 'DO-NOT-PRINT') 'Secret leaked into report'
    foreach ($write in $writes) { Assert-True (-not (Test-Path $write.file)) 'Temporary body left on disk' }
    $again = Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json
    Assert-True ($writes.Count -eq 4 -and $again.note -match 'No Azure changes needed') 'Second run rotated credential or rewrote app'
}
function Set-LegacyConnection {
    # Start with the same complete app and OAuth connection as a successful
    # customer setup, then model only the URI defect shipped in version 1.0.0.
    Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json | Out-Null
    $script:legacyUri = "api://erato.example.com/botid-$($base.AuthAppId)"
    $app.identifierUris = @($app.identifierUris | Where-Object { $_ -cne $settings.SsoResource }) + $legacyUri
    ($connection.properties.parameters | Where-Object key -eq 'tokenExchangeUrl').value = $legacyUri
    $writes.Clear(); $calls.Clear()
}
Test-Case 'legacy connection preview is read-only and describes its repair' {
    Set-LegacyConnection
    $report = Invoke-EratoSetup -Settings $settings -WhatIf -Json
    Assert-True ($report.plan.repairConnectionResource -and -not $report.plan.createConnection -and $writes.Count -eq 0) 'Legacy preview must plan a repair without writes'
}
Test-Case 'legacy repair preserves credentials and existing URIs and is idempotent' {
    Set-LegacyConnection
    $before = $connection.properties | ConvertTo-Json -Depth 50 | ConvertFrom-Json -AsHashtable
    $report = Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json
    Assert-True ($report.exitCode -eq 0 -and $writes.Count -eq 2) 'Expected one app URI patch and one connection patch'
    Assert-True (-not @($writes | Where-Object method -ne 'PATCH').Count) 'Repair created a credential or replaced the connection'
    Assert-True ($legacyUri -in $app.identifierUris -and $settings.SsoResource -in $app.identifierUris) 'Repair removed the existing URI or failed to add the correct URI'
    foreach ($key in @('clientId', 'serviceProviderId', 'scopes')) { Assert-True ($connection.properties[$key] -ceq $before[$key]) "Repair changed $key" }
    Assert-True (-not $report.Contains('credential')) 'Repair returned a new credential'
    $again = Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json
    Assert-True ($writes.Count -eq 2 -and $again.exitCode -eq 0 -and $again.note -match 'No Azure changes needed') 'Repair is not idempotent'
}
Test-Case 'repair rejects legacy-looking connections with a different identity or permissions' {
    foreach ($field in @('clientId', 'serviceProviderId', 'scopes', 'tenantId', 'tokenExchangeUrl')) {
        Reset-Fixture; Set-LegacyConnection
        if ($field -in @('tenantId', 'tokenExchangeUrl')) { ($connection.properties.parameters | Where-Object key -eq $field).value = 'unrelated-value' }
        else { $connection.properties[$field] = 'unrelated-value' }
        Assert-Throws { Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json } 'different settings'
        Assert-True ($writes.Count -eq 0) "Changed a connection despite mismatched $field"
    }
}
Test-Case 'connection repair failure reports partial state and can be retried' {
    Set-LegacyConnection
    $script:failRepair = $true
    Assert-Throws { Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json } 'Completed: Added missing Entra SSO settings'
    Assert-True (-not @($writes | Where-Object method -eq 'POST').Count) 'Failed repair created a credential'
    $script:failRepair = $false
    $report = Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json
    Assert-True ($report.exitCode -eq 0) 'Repair retry did not complete'
}
Test-Case 'pre-authorization failure preserves the saved scope and resumes without a duplicate' {
    $script:failPreauthorization = $true
    Assert-Throws { Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json } 'Completed: Enabled the access_as_user scope'
    Assert-True (-not @($writes | Where-Object method -eq 'POST').Count) 'Created a credential before pre-authorization succeeded'
    $scopeId = ($app.api.oauth2PermissionScopes | Where-Object value -eq 'access_as_user').id
    $script:failPreauthorization = $false
    $report = Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json
    Assert-True (($app.api.oauth2PermissionScopes | Where-Object value -eq 'access_as_user').id -eq $scopeId) 'Retry replaced the saved scope'
    Assert-True ($report.exitCode -eq 0) 'Retry did not complete'
}
Test-Case 'failed OAuth creation reports partial state without exposing credentials' {
    $script:failConnection = $true
    Assert-Throws { Invoke-EratoSetup -Settings $settings -Apply -Confirm:$false -Json } 'credential-key-id.*Entra changes may already be applied'
    foreach ($write in $writes) { Assert-True (-not (Test-Path $write.file)) 'Failed request left credential on disk' }
}
Test-Case 'untrusted pagination/API targets are rejected before CLI execution' {
    Assert-Throws { Invoke-EratoApi -Url 'https://graph.microsoft.com.evil.example/v1.0/applications' } 'outside public Azure'
    Assert-True ($calls.Count -eq 0) 'Sent a request to an untrusted host'
}
Test-Case 'CLI failures redact raw responses' {
    function global:az { $global:LASTEXITCODE = 1; '403 DO-NOT-PRINT-THIS-SECRET' }
    try {
        try { & $realAz -Arguments @('rest'); throw 'Expected CLI failure' }
        catch { Assert-True ($_.Exception.Message -match 'AccessDenied' -and $_.Exception.Message -notmatch 'DO-NOT-PRINT') 'CLI error exposed raw response' }
    } finally { Remove-Item function:global:az }
}
Write-Host "All $passed offline PowerShell tests passed."
