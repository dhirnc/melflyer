const $ = (id) => document.getElementById(id);
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Three splash designs to choose between. The pick is remembered, and ?splash=b forces one.
export function initSplash() {
  const title = $('title');
  const fit = () => { title.style.zoom = Math.min(1, Math.max(0.4, Math.min(innerWidth / 900, innerHeight / 720))); };
  addEventListener('resize', fit);
  fit();
  const wanted = new URLSearchParams(location.search).get('splash') || localStorage.getItem('splash');
  if (['a', 'b', 'c'].includes(wanted)) title.dataset.splash = wanted;
  for (const b of title.querySelectorAll('[data-pick]')) {
    b.addEventListener('click', () => {
      title.dataset.splash = b.dataset.pick;
      localStorage.setItem('splash', b.dataset.pick);
    });
  }
}

export function createHud(postcards) {
  const list = $('list');
  const rows = postcards.map((p) => {
    const li = document.createElement('li');
    li.textContent = p.name;
    list.appendChild(li);
    return li;
  });
  $('count').textContent = `0/${postcards.length}`;

  let toastTimer = 0;
  let noticeText = '';

  return {
    show() {
      $('hud').classList.remove('hidden');
      setTimeout(() => ($('keys').style.opacity = 0), 14000);
    },
    toggle() {
      $('hud').classList.toggle('hidden');
    },
    status(text) {
      $('status').textContent = text;
    },
    ready(onStart) {
      $('status').style.display = 'none';
      const go = $('go');
      go.style.display = 'inline-block';
      const begin = () => {
        if ($('title').classList.contains('gone')) return;
        $('title').classList.add('gone');
        onStart();
      };
      go.addEventListener('click', begin);
      addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') begin(); });
    },
    collect(index, card, got, total) {
      rows[index].classList.add('got');
      $('count').textContent = `${got}/${total}`;
      $('toast-name').textContent = card.name;
      $('toast-hint').textContent = got === total ? 'That’s the full set. Lovely flying.' : card.hint;
      $('toast').firstElementChild.textContent = card.land ? 'logbook stamped' : 'postcard collected';
      $('toast').classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3600);
    },
    fx(name, on) {
      $(`fx-${name}`).classList.toggle('on', on);
    },
    notice(text) {
      if (text === noticeText) return;
      noticeText = text;
      if (text) $('notice').textContent = text;
      $('notice').classList.toggle('show', !!text);
    },
    update(flight, boostK, guide, fps, where) {
      $('speed').textContent = Math.round(flight.speed * 3.6);
      $('alt').textContent = Math.max(0, Math.round(flight.pos.y - 3.4));
      $('boost').firstElementChild.style.width = `${Math.round(boostK * 100)}%`;
      const h = flight.heading;
      $('heading').textContent = `${POINTS[Math.round(h / 45) % 8]} · ${String(Math.round(h) % 360).padStart(3, '0')}°`;
      $('suburb').textContent = where;
      if (guide) {
        const dx = guide.item.g.position.x - flight.pos.x, dz = guide.item.g.position.z - flight.pos.z;
        const bearing = Math.atan2(dx, -dz) + flight.yaw;
        $('arrow').style.transform = `rotate(${bearing}rad)`;
        $('next').textContent = guide.item.name;
        $('dist').textContent = guide.distance > 1000 ? `${(guide.distance / 1000).toFixed(1)} km` : `${Math.round(guide.distance / 10) * 10} m`;
      } else {
        $('next').textContent = 'All postcards collected';
        $('dist').textContent = 'free flight';
      }
      $('fps').textContent = `${fps} fps`;
    },
  };
}
