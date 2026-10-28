# A user-operated web reader. Only explicit text selection is sent to localhost.
$script:ReaderWindow=$null; $script:ReaderView=$null; $script:ReaderJob=$null; $script:ReaderCapturePending=$false
function Test-ReaderAddress([string]$Value) {
  try { $uri=[Uri]$Value; return $uri.Scheme -eq 'https' -and $uri.Port -eq 443 -and $uri.Host -in @('instagram.com','www.instagram.com','x.com','www.x.com','twitter.com','www.twitter.com','www.president.gov.ua','www.gov.uk','www.whitehouse.gov','www.state.gov','www.defense.gov','home.treasury.gov','en.kremlin.ru','mid.ru','www.fmprc.gov.cn','english.www.gov.cn','www.gov.il','president.ir','mfa.gov.ir','www.elysee.fr','www.bundesregierung.de','www.pmindia.gov.in','www.tccb.gov.tr','japan.kantei.go.jp','www.nato.int','www.un.org','news.un.org','www.consilium.europa.eu') } catch { return $false }
}
function Open-SocialReader($Job) {
  if (-not (Test-ReaderAddress $Job.url)) { return }
  $script:ReaderJob=$Job; $script:ReaderCapturePending=$false
  if ($script:ReaderWindow -and -not $script:ReaderWindow.IsDisposed) { $script:ReaderView.Source=[Uri]$Job.url; $script:ReaderWindow.Show(); $script:ReaderWindow.Activate(); return }
  try {
    $library=Join-Path $PSScriptRoot 'webview2'; $env:PATH=$library+';'+$env:PATH
    Add-Type -Path (Join-Path $library 'Microsoft.Web.WebView2.Core.dll')
    Add-Type -Path (Join-Path $library 'Microsoft.Web.WebView2.WinForms.dll')
    $script:ReaderWindow=New-Object Windows.Forms.Form
    $script:ReaderWindow.Text='Khabarnama - selected public post reader'; $script:ReaderWindow.Width=1100; $script:ReaderWindow.Height=850
    $script:ReaderView=New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $properties=New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
    $properties.UserDataFolder=Join-Path $script:DataRoot 'social-reader-profile'; $script:ReaderView.CreationProperties=$properties; $script:ReaderView.Dock='Fill'
    $bar=New-Object Windows.Forms.FlowLayoutPanel; $bar.Dock='Top'; $bar.Height=56; $bar.RightToLeft='Yes'
    $capture=New-Object Windows.Forms.Button; $capture.Text='دریافت متن انتخاب‌شده'; $capture.AutoSize=$true; $capture.Height=38
    $instruction=New-Object Windows.Forms.Label; $instruction.Text='یک پست عمومی یا سخنرانی رسمی را باز کنید، متن آن را انتخاب کنید، سپس دکمه را بزنید. ورود را خودتان در سایت رسمی انجام دهید.'; $instruction.AutoSize=$true
    $bar.Controls.Add($capture); $bar.Controls.Add($instruction)
    $script:ReaderView.Add_CoreWebView2InitializationCompleted({param($sender,$eventArgs)
      if(-not $eventArgs.IsSuccess){[Windows.Forms.MessageBox]::Show('WebView2 could not initialize. Use manual link and text import.','Khabarnama')|Out-Null;return}
      $sender.CoreWebView2.Add_NavigationStarting({param($web,$webEvent)
        if(-not(Test-ReaderAddress $webEvent.Uri)){$webEvent.Cancel=$true;$uri=[Uri]$webEvent.Uri;if($uri.Scheme -in @('https','http')){Start-Process $uri.AbsoluteUri}}
      })
      $sender.CoreWebView2.Add_NewWindowRequested({param($web,$webEvent)
        $webEvent.Handled=$true;if(Test-ReaderAddress $webEvent.Uri){$script:ReaderView.CoreWebView2.Navigate($webEvent.Uri)}else{$uri=[Uri]$webEvent.Uri;if($uri.Scheme -in @('https','http')){Start-Process $uri.AbsoluteUri}}
      })
      $sender.CoreWebView2.Add_WebMessageReceived({param($web,$webEvent)
        if(-not $script:ReaderCapturePending){return};$script:ReaderCapturePending=$false
        try {
          if(-not(Test-ReaderAddress $webEvent.Source) -or $webEvent.Source -ne $script:ReaderView.CoreWebView2.Source){throw 'Unexpected page source.'}
          $message=$webEvent.WebMessageAsJson|ConvertFrom-Json
          if($message.kind -ne 'khabarnama-selected-text' -or -not $script:ReaderJob){return}
          $body=@{id=$script:ReaderJob.id;url=$script:ReaderView.CoreWebView2.Source;text=[string]$message.text;publishedAt=[string]$message.publishedAt}
          Call-Local '/api/desktop/reader/capture' 'POST' $body|Out-Null
          [Windows.Forms.MessageBox]::Show('متن برای پیش‌نمایش آماده شد. به خبرنما برگردید و «بررسی متن دریافت‌شده» را بزنید؛ سپس آن را تأیید کنید.','Khabarnama')|Out-Null
        } catch {[Windows.Forms.MessageBox]::Show('متن دریافت نشد. یک پست را باز کنید، فقط متن آن را انتخاب کنید و دوباره تلاش کنید. ورود دستی متن و لینک نیز در خبرنما موجود است.','Khabarnama')|Out-Null}
      })
    })
    $capture.Add_Click({
      if(-not $script:ReaderView.CoreWebView2){return};$script:ReaderCapturePending=$true
      $scriptCode=@'
(()=>{const text=window.getSelection()?.toString()||'';if(text.trim().length<2){alert('ابتدا متن پست را انتخاب کنید.');return;}const range=window.getSelection().rangeCount?window.getSelection().getRangeAt(0):null;const node=range?.commonAncestorContainer;const element=node?.nodeType===1?node:node?.parentElement;const article=element?.closest('article');window.chrome.webview.postMessage({kind:'khabarnama-selected-text',text:text.slice(0,20000),publishedAt:article?.querySelector('time[datetime]')?.getAttribute('datetime')||null});})()
'@
      $script:ReaderView.CoreWebView2.ExecuteScriptAsync($scriptCode)|Out-Null
    })
    $script:ReaderWindow.Controls.Add($script:ReaderView); $script:ReaderWindow.Controls.Add($bar)
    $script:ReaderView.Source=[Uri]$Job.url; $script:ReaderWindow.Show(); $script:ReaderWindow.Activate()
  } catch {[Windows.Forms.MessageBox]::Show('The reader needs Microsoft WebView2. Use manual text and link import in Khabarnama.','Khabarnama')|Out-Null}
}
