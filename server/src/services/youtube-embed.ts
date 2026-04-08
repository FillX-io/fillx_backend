// YouTube Embed HTML generator
// Generates an HTML page with embedded YouTube player

interface YouTubeEmbedParams {
  videoId: string;
  autoplay?: string;
  mute?: string;
  origin?: string;
}

const ALLOWED_ORIGINS: RegExp[] = [
  /^https:\/\/(.*\.)?worldmonitor\.app$/,
  /^https:\/\/worldmonitor-[a-z0-9-]+-elie-habib-projects\.vercel\.app$/,
  /^https:\/\/worldmonitor-[a-z0-9-]+\.vercel\.app$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^tauri:\/\/localhost$/,
];

function parseFlag(value: string | null | undefined, fallback: string = '1'): string {
  if (value === '0' || value === '1') return value;
  return fallback;
}

function sanitizeVideoId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return /^[A-Za-z0-9_-]{11}$/.test(value) ? value : null;
}

function sanitizeOrigin(raw: string | null | undefined): string {
  if (!raw) return 'https://worldmonitor.app';
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:' &&
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'tauri:'
    ) {
      return 'https://worldmonitor.app';
    }
    const origin = parsed.origin !== 'null' ? parsed.origin : raw;
    if (ALLOWED_ORIGINS.some((p) => p.test(origin))) return origin;
  } catch {
    /* invalid URL */
  }
  return 'https://worldmonitor.app';
}

export function generateYouTubeEmbed(
  params: YouTubeEmbedParams
): { html: string } | { error: string } {
  const videoId = sanitizeVideoId(params.videoId);

  if (!videoId) {
    return { error: 'Missing or invalid videoId' };
  }

  const autoplay = parseFlag(params.autoplay, '1');
  const mute = parseFlag(params.mute, '1');
  const origin = sanitizeOrigin(params.origin);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="referrer" content="strict-origin-when-cross-origin" />
  <style>
    html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}
    #player{width:100%;height:100%}
    #play-overlay{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(0,0,0,0.4)}
    #play-overlay svg{width:72px;height:72px;opacity:0.9;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5))}
    #play-overlay.hidden{display:none}
  </style>
</head>
<body>
  <div id="player"></div>
  <div id="play-overlay"><svg viewBox="0 0 68 48"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="red"/><path d="M45 24L27 14v20" fill="#fff"/></svg></div>
  <script>
    var tag=document.createElement('script');
    tag.src='https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    var player,overlay=document.getElementById('play-overlay'),started=false;
    function hideOverlay(){overlay.classList.add('hidden')}
    function onYouTubeIframeAPIReady(){
      player=new YT.Player('player',{
        videoId:'${videoId}',
        host:'https://www.youtube-nocookie.com',
        playerVars:{autoplay:${autoplay},mute:${mute},playsinline:1,rel:0,controls:1,modestbranding:1,enablejsapi:1,origin:${JSON.stringify(origin)},widget_referrer:${JSON.stringify(origin)}},
        events:{
          onReady:function(){
            window.parent.postMessage({type:'yt-ready'},'*');
            if(${autoplay}===1){player.playVideo()}
          },
          onError:function(e){window.parent.postMessage({type:'yt-error',code:e.data},'*')},
          onStateChange:function(e){
            window.parent.postMessage({type:'yt-state',state:e.data},'*');
            if(e.data===1||e.data===3){hideOverlay();started=true}
          }
        }
      });
    }
    overlay.addEventListener('click',function(){
      if(player&&player.playVideo){player.playVideo();player.unMute();hideOverlay()}
    });
    setTimeout(function(){if(!started)overlay.classList.remove('hidden')},3000);
    window.addEventListener('message',function(e){
      if(!player||!player.getPlayerState)return;
      var m=e.data;if(!m||!m.type)return;
      switch(m.type){
        case'play':player.playVideo();break;
        case'pause':player.pauseVideo();break;
        case'mute':player.mute();break;
        case'unmute':player.unMute();break;
        case'loadVideo':if(m.videoId)player.loadVideoById(m.videoId);break;
      }
    });
  </script>
</body>
</html>`;

  return { html };
}
