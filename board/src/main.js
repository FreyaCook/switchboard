import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { currentUserId, fallbackBoard, loadBoardData, loadPulse, pollBoardData } from './board-data.js';
import { createPatchAudio } from './patch-audio.js';
import './style.css';

const socketsPerLine = 4;
const portrait = window.matchMedia('(max-width: 767px)');
const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const message = document.querySelector('#message');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const metal = (color, roughness, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
let applyBoardSnapshot;
const playClick = createPatchAudio();

// Honour the panel's mute toggle (same localStorage key as panel/panel.js), checked on every play.
function playPatchSound(kind) {
  try {
    if (window.localStorage.getItem('switchboardMuted') === '1') return;
  } catch {
    // localStorage can be unavailable; treat as not muted.
  }
  playClick(kind);
}

export function updateBoardData(snapshot) {
  applyBoardSnapshot?.(snapshot);
}

async function startBoard() {
  const snapshot = await loadBoardData().catch(() => fallbackBoard);
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    stage.append(renderer.domElement);
    applyBoardSnapshot = renderBoard(renderer, snapshot);
    pollBoardData(updateBoardData);
  } catch (error) {
    console.error(error);
    status.hidden = false;
    status.textContent = 'The switchboard could not start. Check that WebGL 2 is enabled.';
  }
}

startBoard();

// Keep the board clear of the overlaid panel: inset <main> by however far the panel overlaps it.
function fitBoardToPanel() {
  const main = document.querySelector('main');
  const panelEl = document.querySelector('#panel');
  if (!main || !panelEl) return;
  const mainBox = main.getBoundingClientRect();
  const panelBox = panelEl.getBoundingClientRect();
  const bottom = portrait.matches ? Math.max(0, mainBox.bottom - panelBox.top) : 0;
  const right = portrait.matches ? 0 : Math.max(0, mainBox.right - panelBox.left);
  document.documentElement.style.setProperty('--panel-inset-bottom', `${Math.round(bottom)}px`);
  document.documentElement.style.setProperty('--panel-inset-right', `${Math.round(right)}px`);
}

{
  const resizeObserver = new ResizeObserver(fitBoardToPanel);
  resizeObserver.observe(document.querySelector('main'));
  resizeObserver.observe(document.querySelector('#panel'));
  portrait.addEventListener('change', fitBoardToPanel);
  fitBoardToPanel();
}

// Once the user has started (typed in the panel form, or has a saved id), narrow screens drop
// the title and colour key; the stage's ResizeObserver re-fits the board.
{
  let typed = false;
  const hasStarted = () => {
    try {
      if (window.localStorage.getItem('switchboardPersonId')) return true;
    } catch {
      // localStorage can be unavailable.
    }
    return typed;
  };
  const update = () => document.documentElement.classList.toggle('is-started', hasStarted());
  document.querySelector('#panel')?.addEventListener('input', () => {
    typed = true;
    update();
  });
  window.setInterval(update, 1000);
  update();
}

// Campus pulse strip: refreshed every 10 seconds, hidden whenever the request fails.
{
  const pulseEl = document.querySelector('#pulse');
  async function refreshPulse() {
    try {
      const { onAirByLine, busiestToday } = await loadPulse();
      const counts = Object.entries(onAirByLine).map(([name, count]) => `${count} ${name}`).join(' · ');
      const busiest = busiestToday?.line ? ` | Busiest today: ${busiestToday.line}` : '';
      pulseEl.textContent = `Right now: ${counts}${busiest}`;
      pulseEl.hidden = false;
    } catch {
      pulseEl.hidden = true;
    } finally {
      window.setTimeout(refreshPulse, 10000);
    }
  }
  if (pulseEl) refreshPulse();
}

function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  parent.add(object);
  return object;
}

function panel(parent, width, height, depth, radius, material, x, y, z) {
  return mesh(parent, new RoundedBoxGeometry(width, height, depth, 2, radius), material, x, y, z);
}

function renderBoard(renderer, initialSnapshot) {
  const initialColours = new Map(initialSnapshot.lines.map(({ name, colour }) => [name, colour]));
  const lines = fallbackBoard.lines.map(({ name, colour }) => ({
    name,
    colour: initialColours.get(name) || colour,
  }));
  const scene = new THREE.Scene();
  const board = new THREE.Group();
  scene.add(board);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment, 0.04).texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();
  environment.dispose();

  const walnut = new THREE.MeshStandardMaterial({
    map: walnutTexture(), roughness: 0.66, envMapIntensity: 0.48,
  });
  const edge = metal(0x1f1013, 0.49);
  const face = metal(0x101520, 0.73, 0.48);
  const moduleFace = metal(0x1b2333, 0.68, 0.38);
  const brass = metal(0xd1a05b, 0.26, 0.8);
  const copper = metal(0x9a5b3b, 0.36, 0.76);
  const darkBrass = metal(0x543820, 0.4, 0.73);
  const black = metal(0x080609, 0.9);

  const socketRim = new THREE.TorusGeometry(0.218, 0.052, 10, 28);
  const socketBevel = new THREE.TorusGeometry(0.253, 0.023, 8, 28);
  const socketInset = new THREE.TorusGeometry(0.16, 0.022, 8, 24);
  const socketHole = new THREE.CircleGeometry(0.18, 24);
  const lampRim = new THREE.TorusGeometry(0.104, 0.024, 8, 24);
  const lens = new THREE.SphereGeometry(0.094, 16, 10);
  const screwHead = new THREE.CylinderGeometry(0.058, 0.058, 0.025, 16);
  screwHead.rotateX(Math.PI / 2);
  const slot = new THREE.PlaneGeometry(0.077, 0.012);
  const haloMap = glowTexture();
  let peopleBySlot = new Map();
  const connections = new Map();
  let connectionSequence = 0;
  const haloGeometry = new THREE.PlaneGeometry(0.75, 0.75);
  const youBadge = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.28),
    labelMaterial('YOU', '#fff0bf', true, true));
  youBadge.position.set(0.42, 0.42, 0.56);
  const reflections = Array.from({ length: 3 }, () => new THREE.PointLight(0xffffff, 0, 0.66));

  function screw(parent, x, y, z) {
    mesh(parent, screwHead, copper, x, y, z);
    mesh(parent, slot, black, x, y, z + 0.013).rotation.z = x + y;
  }

  const legend = document.querySelector('#legend');
  const lineVisuals = lines.map(({ name, colour }) => {
    const item = document.createElement('li');
    const dot = document.createElement('span');
    dot.style.setProperty('--line-colour', colour);
    item.append(dot, name);
    legend.append(item);
    return {
      dot, colour, plaque: labelMaterial(name.toUpperCase(), colour, true),
      dim: metal(new THREE.Color(colour).multiplyScalar(0.075), 0.38, 0.27),
    };
  });
  const nameGeometry = new THREE.PlaneGeometry(1.22, 0.25);

  // The slot ID belongs to the student. Only its position changes at the breakpoint.
  // Slot index = lane * lines.length + lineIndex, so adding a lane never renumbers existing jacks.
  const sockets = [];
  let laneCount = 0;

  function createSocket(index) {
    const cell = new THREE.Group();
    const lineIndex = index % lines.length;
    const laneIndex = Math.floor(index / lines.length);
    board.add(cell);
    panel(cell, 1.31, 1.16, 0.045, 0.08, face, 0, 0.13, 0.49);
    mesh(cell, socketBevel, darkBrass, 0, 0, 0.532);
    mesh(cell, socketRim, brass, 0, 0, 0.556);
    mesh(cell, socketInset, copper, 0, 0, 0.543);
    mesh(cell, socketHole, black, 0, 0, 0.517);
    mesh(cell, lampRim, brass, 0, 0.42, 0.534);
    const number = String(laneIndex * lines.length + lineIndex + 1).padStart(2, '0');
    mesh(cell, new THREE.PlaneGeometry(0.33, 0.17),
      labelMaterial(number, '#d6b28d'), 0.44, 0, 0.52);

    const lit = new THREE.MeshStandardMaterial({ roughness: 0.23 });
    const halo = new THREE.MeshBasicMaterial({
      map: haloMap, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const glow = mesh(cell, haloGeometry, halo, 0, 0.42, 0.527);
    glow.visible = false;
    const { dim } = lineVisuals[lineIndex];
    const lamp = mesh(cell, lens, dim, 0, 0.42, 0.543);
    lamp.scale.z = 0.65;
    const nameplate = new THREE.Mesh(nameGeometry, null);
    nameplate.position.set(0, -0.335, 0.523);
    nameplate.visible = false;
    cell.add(nameplate);
    return { cell, lamp, lit, glow, halo, dim, nameplate };
  }

  // Every line gets the same number of jacks, so a full line grows the whole board by one lane.
  function ensureLanes(count) {
    while (laneCount < count) {
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        sockets.push(createSocket(laneCount * lines.length + lineIndex));
      }
      laneCount += 1;
    }
  }

  ensureLanes(socketsPerLine);

  const layouts = new Map();

  function createLayout(isPortrait, lanes) {
    const cabinet = new THREE.Group();
    board.add(cabinet);
    const extra = lanes - socketsPerLine;
    const extraWidth = isPortrait ? extra * 1.71 : 0;
    const extraHeight = isPortrait ? 0 : extra * 1.31;
    const width = (isPortrait ? 8.08 : 11.85) + extraWidth;
    const height = (isPortrait ? 11.68 : 7.75) + extraHeight;

    panel(cabinet, width, height, 0.92, 0.21, edge, 0, 0, -0.37);
    panel(cabinet, width - 0.15, height - 0.10, 0.44, 0.19, walnut, 0, 0, 0.10);
    panel(cabinet, width - 0.80, height - 0.72, 0.13, 0.12, copper, 0, 0, 0.313);
    panel(cabinet, width - 0.86, height - 0.78, 0.13, 0.11, edge, 0, 0, 0.328);
    panel(cabinet, width - 0.99, height - 0.91, 0.14, 0.11, brass, 0, 0, 0.342);
    panel(cabinet, width - 1.06, height - 0.98, 0.14, 0.10, face, 0, 0, 0.353);

    const positions = [];
    lines.forEach((_, lineIndex) => {
      const x = (lineIndex - 2.5) * 1.71;
      const y = (2.5 - lineIndex) * 1.62 - 0.22;
      if (isPortrait) {
        panel(cabinet, 6.81 + extraWidth, 1.54, 0.07, 0.055, edge, 0, y + 0.17, 0.43);
        panel(cabinet, 6.74 + extraWidth, 1.48, 0.075, 0.053, moduleFace, 0, y + 0.17, 0.445);
        screw(cabinet, -3.22 - extraWidth / 2, y + 0.72, 0.495);
        screw(cabinet, 3.22 + extraWidth / 2, y + 0.72, 0.495);
      } else {
        panel(cabinet, 1.58, 6.22 + extraHeight, 0.07, 0.055, edge, x, -0.07, 0.43);
        panel(cabinet, 1.52, 6.16 + extraHeight, 0.075, 0.053, moduleFace, x, -0.07, 0.445);
        screw(cabinet, x - 0.59, -2.98 - extraHeight / 2, 0.495);
        screw(cabinet, x + 0.59, -2.98 - extraHeight / 2, 0.495);
      }

      const plaqueX = isPortrait ? 0 : x;
      const plaqueY = isPortrait ? y + 0.53 : 2.66 + extraHeight / 2;
      panel(cabinet, 1.46, 0.48, 0.062, 0.03, copper, plaqueX, plaqueY, 0.49);
      mesh(cabinet, new THREE.PlaneGeometry(1.39, 0.42),
        lineVisuals[lineIndex].plaque, plaqueX, plaqueY, 0.525);

      for (let lane = 0; lane < lanes; lane += 1) {
        positions[lane * lines.length + lineIndex] = isPortrait
          ? new THREE.Vector3((lane - (lanes - 1) / 2) * 1.71, y, 0)
          : new THREE.Vector3(x, 1.66 + extraHeight / 2 - lane * 1.31, 0);
      }
    });

    const screwX = width / 2 - 0.695;
    const screwY = height / 2 - 0.655;
    for (const x of [-screwX, screwX]) {
      for (const y of [-screwY, screwY]) screw(cabinet, x, y, 0.44);
    }

    return { cabinet, positions, width, height };
  }

  scene.add(new THREE.HemisphereLight(0xffdfbd, 0x37395f, 1.35));
  const key = new THREE.DirectionalLight(0xffd4a4, 2.1);
  key.position.set(-3, 6, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x93afff, 1.35);
  fill.position.set(5, -2, 3);
  scene.add(fill);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0, 20);
  let layout;

  function syncLayout() {
    const isPortrait = portrait.matches;
    const key = `${isPortrait}:${laneCount}`;
    if (!layouts.has(key)) layouts.set(key, createLayout(isPortrait, laneCount));
    const nextLayout = layouts.get(key);
    if (layout !== nextLayout) {
      if (layout) layout.cabinet.visible = false;
      layout = nextLayout;
      layout.cabinet.visible = true;
      sockets.forEach(({ cell }, index) => cell.position.copy(layout.positions[index]));
      for (const connection of connections.values()) buildCord(connection);
    }
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!width || !height) return;
    const isPortrait = portrait.matches;
    syncLayout();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isPortrait ? 1.5 : 1.75));
    const aspect = width / height;
    const halfHeight = Math.max(layout.height / 2 + 0.25, (layout.width / 2 + 0.35) / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  const duration = 1800;
  const waiting = 'Stand by, searching for your connection…';
  const announcement = document.createElement('span');
  const terminalText = document.createElement('span');
  terminalText.setAttribute('aria-hidden', 'true');
  announcement.className = 'operator-announcement';
  message.replaceChildren(announcement, terminalText);

  function buildCord(connection) {
    connection.cord?.dispose();
    const from = layout.positions[connection.from].clone().setZ(0.535);
    const to = layout.positions[connection.to].clone().setZ(0.535);
    connection.cord = makeCord(board, from, to, connection.colour, brass, darkBrass);
    connection.cord.update(progressAt(connection, performance.now()));
  }

  // The plug click lands when the cord's animation finishes and the plug reaches the second jack.
  function schedulePlugClick(connection) {
    const wait = reducedMotion.matches
      ? 0 : Math.max(0, connection.startAt + duration - performance.now());
    window.setTimeout(() => {
      for (const current of connections.values()) {
        if (current === connection) {
          playPatchSound('plug');
          return;
        }
      }
    }, wait);
  }

  function progressAt(connection, now) {
    return reducedMotion.matches
      ? 1 : THREE.MathUtils.clamp((now - connection.startAt) / duration, 0, 1);
  }

  let hasRenderedSnapshot = false;

  function applySnapshot(snapshot) {
    peopleBySlot = assignSockets(snapshot.people, lines, peopleBySlot);
    const lanesNeeded = Math.max(socketsPerLine,
      ...Array.from(peopleBySlot.keys(), (index) => Math.floor(index / lines.length) + 1));
    ensureLanes(lanesNeeded);
    if (layout) syncLayout();
    const socketByPerson = new Map(Array.from(peopleBySlot, ([index, person]) => [person.id, index]));
    const coloursByLine = new Map(snapshot.lines.map(({ name, colour }) => [name, colour]));
    const colourOf = (person) => person.colour || coloursByLine.get(person.line);
    lines.forEach(({ name }, index) => {
      const colour = coloursByLine.get(name);
      const visual = lineVisuals[index];
      if (!colour || colour === visual.colour) return;
      visual.colour = colour;
      visual.dot.style.setProperty('--line-colour', colour);
      visual.dim.color.set(colour).multiplyScalar(0.075);
      visual.plaque.map.dispose();
      visual.plaque.map = labelTexture(name.toUpperCase(), colour, true);
    });
    const nextConnections = new Map();
    const newConnections = [];
    let unplugged = false;
    const now = performance.now();
    let startAt = now;
    if (!reducedMotion.matches) {
      const incomingIds = new Set(snapshot.connections.map(({ id }) => id));
      for (const [id, connection] of connections) {
        if (incomingIds.has(id) && Number.isFinite(connection.startAt)) {
          startAt = Math.max(startAt, connection.startAt + duration);
        }
      }
    }

    for (const { id, personIds, operatorLine } of snapshot.connections) {
      const from = socketByPerson.get(personIds[0]);
      const to = socketByPerson.get(personIds[1]);
      if (from === undefined || to === undefined || from === to || nextConnections.has(id)) continue;
      const colour = colourOf(peopleBySlot.get(from));
      let connection = connections.get(id);
      if (!connection) {
        connection = { startAt, sequence: connectionSequence++ };
        newConnections.push(connection);
        if (!reducedMotion.matches) startAt += duration;
      }
      const changed = connection.from !== from || connection.to !== to || connection.colour !== colour;
      Object.assign(connection, { from, to, colour, operatorLine });
      if (layout && changed) buildCord(connection);
      nextConnections.set(id, connection);
    }

    for (const [id, connection] of connections) {
      if (!nextConnections.has(id)) {
        unplugged = true;
        connection.cord?.dispose();
      }
    }
    if (hasRenderedSnapshot) {
      for (const connection of newConnections) schedulePlugClick(connection);
      if (unplugged) playPatchSound('unplug');
    }
    hasRenderedSnapshot = true;
    connections.clear();
    for (const [id, connection] of nextConnections) connections.set(id, connection);

    youBadge.removeFromParent();
    reflections.forEach((light) => light.removeFromParent());
    let reflectionIndex = 0;
    const occupants = [];
    sockets.forEach(({ cell, lamp, lit, glow, halo, dim, nameplate }, index) => {
      const person = peopleBySlot.get(index);
      const isCurrentUser = person?.id === currentUserId;
      cell.name = person?.id || '';
      const name = person?.firstName || '';
      if (nameplate.name !== name) {
        nameplate.material?.map.dispose();
        nameplate.material?.dispose();
        nameplate.name = name;
        nameplate.material = name ? labelMaterial(name, '#ffe3b6', false, false, true) : null;
        nameplate.visible = !!name;
      }
      lamp.material = person ? lit : dim;
      lamp.scale.set(isCurrentUser ? 1.23 : 1, isCurrentUser ? 1.23 : 1, 0.65);
      glow.visible = !!person;
      glow.scale.setScalar(isCurrentUser ? 1.28 : 1);
      if (!person) return;
      occupants.push(`${name}${isCurrentUser ? ' (you)' : ''}, ${person.line}, ${person.status}`);
      const colour = colourOf(person);
      lit.emissive.set(colour);
      lit.color.copy(lit.emissive).lerp(white, 0.08);
      halo.color.copy(lit.emissive);
      if (isCurrentUser) cell.add(youBadge);
      const light = reflections[reflectionIndex];
      if (light) {
        light.color.copy(lit.emissive);
        light.position.set(0, 0.34, 0.71);
        cell.add(light);
        reflectionIndex += 1;
      }
    });
    stage.setAttribute('aria-label', `Telephone switchboard with ${sockets.length} jacks.`
      + (occupants.length ? ' Occupied sockets: ' + occupants.join('; ') + '.' : ''));
  }

  const white = new THREE.Color(0xffffff);
  const start = performance.now();
  let displayedText;
  let characters = [];

  function updateAnnouncement(now) {
    let latest;
    for (const connection of connections.values()) {
      if (connection.operatorLine && (connection.startAt <= now || reducedMotion.matches)
          && (!latest || connection.sequence > latest.sequence)) latest = connection;
    }
    const text = latest?.operatorLine || waiting;
    if (text !== displayedText) {
      displayedText = text;
      characters = Array.from(text);
      announcement.textContent = text;
    }
    const typing = latest && !reducedMotion.matches && now - latest.startAt < 1100;
    const count = typing
      ? Math.max(1, Math.ceil(characters.length * (now - latest.startAt) / 1100))
      : characters.length;
    const displayed = count === characters.length ? text : characters.slice(0, count).join('');
    if (terminalText.textContent !== displayed) terminalText.textContent = displayed;
    message.classList.toggle('is-typing', !!typing);
  }

  applySnapshot(initialSnapshot);

  // Browsers block audio until the user interacts. If that was the case while the starting cords
  // animated, replay them (with plug clicks) once, on the first click or tap.
  function replayStartingCords() {
    if (reducedMotion.matches) return;
    const delay = 150; // lets the audio context finish resuming from this same click
    const starting = Array.from(connections.values()).sort((x, y) => x.sequence - y.sequence);
    starting.forEach((connection, index) => {
      connection.startAt = performance.now() + delay + index * duration;
      schedulePlugClick(connection);
    });
  }

  if (!navigator.userActivation?.hasBeenActive) {
    window.addEventListener('click', replayStartingCords, { once: true });
  }
  new ResizeObserver(resize).observe(stage);
  portrait.addEventListener('change', resize);
  resize();

  renderer.setAnimationLoop((now) => {
    if (!layout) return;
    const elapsed = (now - start) / 1000;
    const still = reducedMotion.matches;

    for (const socket of sockets) socket.connected = false;
    for (const connection of connections.values()) {
      const progress = progressAt(connection, now);
      connection.cord.update(progress);
      if (progress >= 1) {
        sockets[connection.from].connected = true;
        sockets[connection.to].connected = true;
      }
    }
    for (const [index, person] of peopleBySlot) {
      const { lit, halo, connected } = sockets[index];
      const pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin(elapsed * 2 + index * 1.1);
      const isCurrentUser = person.id === currentUserId;
      lit.emissiveIntensity = 0.7 + pulse * 0.44 + (isCurrentUser ? 0.85 : 0) + (connected ? 0.32 : 0);
      halo.opacity = 0.4 + pulse * 0.24 + (isCurrentUser ? 0.2 : 0) + (connected ? 0.12 : 0);
    }
    reflections.forEach((light, index) => {
      light.visible = !portrait.matches;
      light.intensity = 0.32 + (still ? 0 : 0.08 * Math.sin(elapsed * 2 + index));
    });

    updateAnnouncement(now);
    renderer.render(scene, camera);
  });

  return applySnapshot;
}

function assignSockets(people, lines, previous) {
  const activePeople = people
    .filter(({ status }) => status === 'waiting' || status === 'on_air' || status === 'connected')
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id));
  const assigned = new Map();
  const active = new Map(activePeople.map((person) => [person.id, person]));
  for (const [index, person] of previous) {
    if (!active.has(person.id)) continue;
    assigned.set(index, active.get(person.id));
    active.delete(person.id);
  }
  // Each person takes the first free jack in their own line's row; rows never borrow from other lines.
  for (const person of active.values()) {
    const line = lines.findIndex(({ name }) => name === person.line);
    if (line < 0) continue;
    let lane = 0;
    while (assigned.has(lane * lines.length + line)) lane += 1;
    assigned.set(lane * lines.length + line, person);
  }
  return assigned;
}

function makeCord(board, from, to, colour, brass, darkBrass) {
  const segments = 64;
  const sides = 10;
  const group = new THREE.Group();
  board.add(group);
  const jacket = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(colour).multiplyScalar(0.55),
    roughness: 0.43, clearcoat: 0.32, clearcoatRoughness: 0.32,
    envMapIntensity: 0.6, emissive: colour, emissiveIntensity: 0.065,
  });
  const direction = Math.sign(to.x - from.x) || 1;
  const low = Math.min(from.y, to.y);
  let drape;
  if (from.y === to.y) {
    drape = [new THREE.Vector3((from.x + to.x) / 2, low - 0.46, 0.97)];
  } else if (from.x === to.x) {
    // Route vertical runs through the gap beside the jacks, clear of the nameplates.
    drape = [
      new THREE.Vector3(from.x + 0.69, from.y - 0.13, 0.96),
      new THREE.Vector3(to.x + 0.71, to.y + 0.05, 0.97),
    ];
  } else {
    drape = [
      new THREE.Vector3(from.x + direction * 0.65, from.y - 0.52, 0.96),
      new THREE.Vector3(from.x + direction * 0.73, low - 0.29, 0.97),
      new THREE.Vector3(to.x - direction * 0.36, to.y - 0.40, 0.92),
    ];
  }
  const curve = new THREE.CatmullRomCurve3([
    from.clone().add(new THREE.Vector3(0, 0, 0.44)),
    from.clone().add(new THREE.Vector3(0, 0, 0.68)),
    ...drape,
    to.clone().add(new THREE.Vector3(0, 0, 0.68)),
    to.clone().add(new THREE.Vector3(0, 0, 0.44)),
  ]);
  const geometry = new THREE.TubeGeometry(curve, segments, 0.066, sides, false);
  mesh(group, geometry, jacket);

  const fittings = [
    [0.105, 0.30, -0.235, brass], [0.122, 0.075, -0.12, darkBrass],
    [0.109, 0.036, -0.06, brass], [0.076, 0.09, 0.012, jacket],
    [0.084, 0.025, 0.039, darkBrass],
  ].map(([radius, length, z, surface]) => {
    const barrel = new THREE.CylinderGeometry(radius, radius, length, 16);
    barrel.rotateX(Math.PI / 2);
    return { barrel, z, surface };
  });

  function plug() {
    const assembly = new THREE.Group();
    group.add(assembly);
    for (const { barrel, z, surface } of fittings) mesh(assembly, barrel, surface, 0, 0, z);
    return assembly;
  }

  const fixed = plug();
  const moving = plug();
  const anchor = curve.getPointAt(0);
  const outward = new THREE.Vector3(0, 0, 1);
  const heading = new THREE.Vector3();
  let lastProgress;

  return {
    update(progress) {
      if (progress === lastProgress) return;
      lastProgress = progress;
      group.visible = progress > 0;
      const seat = THREE.MathUtils.smoothstep(progress, 0, 0.18);
      fixed.position.copy(anchor).addScaledVector(outward, (1 - seat) * 0.54);
      const length = THREE.MathUtils.smootherstep(progress, 0.18, 1);
      moving.visible = length > 0.025;
      geometry.setDrawRange(0, Math.floor(length * segments) * sides * 6);
      if (moving.visible) {
        curve.getPointAt(length, moving.position);
        curve.getTangentAt(length, heading).negate();
        moving.quaternion.setFromUnitVectors(outward, heading);
      }
    },
    dispose() {
      group.removeFromParent();
      geometry.dispose();
      jacket.dispose();
      for (const { barrel } of fittings) barrel.dispose();
    },
  };
}

function canvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function labelMaterial(label, colour, plaque = false, prominent = false, personName = false) {
  const map = labelTexture(label, colour, plaque, prominent, personName);
  return new THREE.MeshBasicMaterial({ map, transparent: !plaque, toneMapped: false });
}

function labelTexture(label, colour, plaque, prominent = false, personName = false) {
  return canvasTexture((plaque && !prominent) || personName ? 256 : 120, 80, (context, width, height) => {
    if (plaque) {
      const background = context.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, '#523323');
      background.addColorStop(0.55, '#271b1b');
      background.addColorStop(1, '#1a1112');
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = '#bb8658';
      context.lineWidth = 2;
      context.strokeRect(5, 5, width - 10, height - 10);
    }
    context.font = plaque ? 'bold 32px Georgia' : 'bold 60px Consolas, monospace';
    if (prominent) context.font = 'bold 49px Consolas, monospace';
    if (personName) context.font = 'bold 60px Georgia';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#080509';
    context.fillText(label, width / 2, height / 2 + 2, width - 12);
    context.fillStyle = colour;
    context.fillText(label, width / 2, height / 2, width - 12);
  });
}

function glowTexture() {
  return canvasTexture(64, 64, (context) => {
    const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, '#ffffffdb');
    gradient.addColorStop(0.35, '#ffffff59');
    gradient.addColorStop(1, '#ffffff00');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  });
}

function walnutTexture() {
  return canvasTexture(512, 512, (context, width, height) => {
    context.fillStyle = '#4b2922';
    context.fillRect(0, 0, width, height);
    for (let row = 0; row < height; row += 1) {
      const grain = Math.sin(row * 0.5 + Math.sin(row * 0.11) * 3);
      context.strokeStyle = grain > 0 ? 'rgba(168, 102, 59, 0.22)' : 'rgba(22, 11, 14, 0.30)';
      context.lineWidth = 0.6 + Math.abs(grain);
      context.beginPath();
      context.moveTo(0, row);
      context.bezierCurveTo(width * 0.36, row + 15 * grain, width * 0.7, row - 11 * grain, width, row + 4 * grain);
      context.stroke();
    }
  });
}
