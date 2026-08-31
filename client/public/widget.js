(function() {
  var script = document.currentScript || document.querySelector('script[data-org]');
  if (!script) return;
  var orgSlug = script.getAttribute('data-org');
  if (!orgSlug) return;

  var origin = window.location.origin;
  var chatUrl = origin + "/chat/" + encodeURIComponent(orgSlug) + "?embed=true";

  var container = document.createElement('div');
  container.id = 'onceclic-widget-container';
  container.innerHTML = [
    '<div id="onceclic-chat-modal" style="display:none;position:fixed;bottom:90px;right:24px;width:380px;height:600px;max-width:calc(100vw - 32px);max-height:calc(100vh - 120px);box-shadow:0 20px 40px rgba(0,0,0,0.35);border-radius:16px;overflow:hidden;z-index:999999;border:1px solid rgba(255,255,255,0.1);background:#020617;transition:all 0.3s ease;">',
    '  <iframe src="' + chatUrl + '" style="width:100%;height:100%;border:none;"></iframe>',
    '</div>',
    '<button id="onceclic-launcher-btn" style="position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#059669,#10b981);color:#ffffff;border:none;box-shadow:0 8px 24px rgba(16,185,129,0.35);cursor:pointer;z-index:999999;display:flex;align-items:center;justify-content:center;transition:transform 0.2s ease;">',
    '  <svg id="onceclic-icon-chat" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    '  <svg id="onceclic-icon-close" style="display:none;" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    '</button>'
  ].join('');

  document.body.appendChild(container);

  var modal = document.getElementById('onceclic-chat-modal');
  var btn = document.getElementById('onceclic-launcher-btn');
  var iconChat = document.getElementById('onceclic-icon-chat');
  var iconClose = document.getElementById('onceclic-icon-close');
  var isOpen = false;

  btn.addEventListener('click', function() {
    isOpen = !isOpen;
    if (isOpen) {
      modal.style.display = 'block';
      iconChat.style.display = 'none';
      iconClose.style.display = 'block';
    } else {
      modal.style.display = 'none';
      iconChat.style.display = 'block';
      iconClose.style.display = 'none';
    }
  });
})();
