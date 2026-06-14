import type { PlanCheck } from "@/lib/ai/build-plan";

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function containsAny(pattern: string, label: string): PlanCheck {
  return { type: "contains_any", pattern, label };
}

function gameDebugSmoke(opts: {
  requireCollision: boolean;
  requirePhysicsCube: boolean;
  requireNpc: boolean;
  requireHouse: boolean;
}): PlanCheck {
  const code = `
    var canvas = document.querySelector("canvas");
    if (!canvas || canvas.width < 100 || canvas.height < 100) {
      throw new Error("Game canvas is missing or too small");
    }

    var debug = window.__forgeGameDebug;
    if (!debug || typeof debug !== "object") {
      throw new Error("window.__forgeGameDebug is missing");
    }

    if (debug.sceneReady === false) {
      throw new Error("Debug hook reports sceneReady=false");
    }

    if (!debug.player && !debug.camera && !debug.controls) {
      throw new Error("Debug hook does not expose player/camera/controls state");
    }

    if (${JSON.stringify(opts.requireCollision)}) {
      var colliders = debug.colliders || debug.wallColliders || debug.collisionObjects || [];
      if (!Array.isArray(colliders) || colliders.length < 1) {
        throw new Error("Collision colliders are not exposed");
      }
    }

    if (${JSON.stringify(opts.requirePhysicsCube)}) {
      var cube = debug.physicsCube || debug.cube || (debug.objects && debug.objects.physicsCube);
      var velocity = debug.cubeVelocity || debug.physicsCubeVelocity || (cube && cube.velocity);
      if (!cube) throw new Error("Physics cube is not exposed");
      if (!velocity) throw new Error("Physics cube velocity is not exposed");
      if (typeof debug.throwCube !== "function" && typeof debug.applyCubeImpulse !== "function") {
        throw new Error("No throw/apply impulse function exposed for the cube");
      }
    }

    if (${JSON.stringify(opts.requireNpc)}) {
      if (!debug.npc && !(debug.objects && debug.objects.npc)) {
        throw new Error("NPC is not exposed");
      }
    }

    if (${JSON.stringify(opts.requireHouse)}) {
      var roomCount = Number(debug.roomCount || (debug.rooms && debug.rooms.length) || 0);
      if (roomCount < 1 && !debug.house) {
        throw new Error("House/room structure is not exposed");
      }
    }

    return true;
  `;

  return {
    type: "smoke",
    id: "forge-game-debug",
    label: "Game exposes verifiable runtime state for canvas, controls, collisions, NPCs, and physics",
    code,
  };
}

export function impliedChecksForBuildRequest(request: string): PlanCheck[] {
  const text = request.toLowerCase();
  const wantsGame = has(text, /\b(game|player|playable|wasd|first[-\s]?person|npc|enemy|level|physics|collision)\b/);
  const wantsThree = has(text, /\b(three\.?js|webgl|3d|first[-\s]?person)\b/);
  const wantsHouse = has(text, /\b(house|room|rooms|wall|walls|floor|ceiling|window|furniture)\b/);
  const wantsNpc = has(text, /\b(npc|non[-\s]?player|character|humanoid|speech|bubble|wave|reacts?)\b/);
  const wantsCollision = has(text, /\b(collision|collider|collide|blocked|cannot walk through|can't walk through|wall|walls|npc)\b/);
  const wantsPhysicsCube = has(text, /\b(physics|cube|throw|push|gravity|velocity|impulse|rigid\s*body|rigidbody)\b/);
  const wantsMovement = has(text, /\b(wasd|walk|move|movement|look around|mouse|pointer lock|first[-\s]?person)\b/);
  const wantsComplexGame = wantsThree || wantsPhysicsCube || wantsMovement || wantsCollision || wantsNpc || (wantsGame && wantsHouse);

  if (!wantsComplexGame) return [];

  const checks: PlanCheck[] = [
    { type: "dom_has", element: "canvas", label: "Game must render to a canvas" },
    containsAny("\\brequestAnimationFrame\\b", "Game must run from a real animation loop"),
    containsAny("__forgeGameDebug", "Game must expose window.__forgeGameDebug so Forge can verify runtime state"),
  ];

  if (wantsThree) {
    checks.push(
      containsAny("\\bTHREE\\b|three\\.module\\.js|from\\s+[\"']three[\"']", "3D game must load/use Three.js"),
      containsAny("WebGLRenderer|PerspectiveCamera|Scene\\s*\\(", "3D game must create a real scene, camera, and renderer")
    );
  }

  if (wantsMovement) {
    checks.push(
      containsAny("PointerLockControls|camera\\.rotation|yaw|pitch|mousemove|pointerlock", "First-person controls must implement mouse look"),
      containsAny("keydown|keyup|KeyW|KeyA|KeyS|KeyD|wasd", "Game must implement WASD keyboard movement")
    );
  }

  if (wantsHouse) {
    checks.push(
      containsAny("room|rooms|wall|walls", "House must have room and wall structure"),
      containsAny("floor|ceiling|window", "House must include floor, ceiling, and window details"),
      containsAny("table|chair|bed|furniture", "House must include at least one piece of furniture")
    );
  }

  if (wantsNpc) {
    checks.push(
      containsAny("\\bnpc\\b|nonPlayer|character|humanoid", "Game must create an NPC/character object"),
      containsAny("distanceTo|lookAt|speech|bubble|wave|approach", "NPC must react when the player approaches")
    );
  }

  if (wantsCollision) {
    checks.push(
      containsAny("collider|colliders|collision|blocked|intersect|Box3|wallColliders|circleRectCollision", "Movement must include collision detection")
    );
  }

  if (wantsPhysicsCube) {
    checks.push(
      containsAny("physicsCube", "Physics cube must be represented by a named physicsCube object"),
      containsAny("cubeVelocity|cubeGravity|applyCubeImpulse|throwCube", "Physics cube must have velocity/gravity/impulse state"),
      containsAny("throwCube|applyCubeImpulse|pushCube", "Player must be able to throw or push the physics cube")
    );
  }

  checks.push(
    gameDebugSmoke({
      requireCollision: wantsCollision,
      requirePhysicsCube: wantsPhysicsCube,
      requireNpc: wantsNpc,
      requireHouse: wantsHouse,
    })
  );

  return checks;
}

export function impliedChecksToPrompt(checks: PlanCheck[]): string {
  if (!checks.length) return "";
  const lines = checks.map((check) => {
    if (check.type === "contains_any") return `- ${check.label ?? `Must contain /${check.pattern}/i`}`;
    if (check.type === "dom_has") return `- ${check.label ?? `Must render <${check.element}>`}`;
    if (check.type === "smoke") return `- ${check.label}`;
    if (check.type === "contains") return `- ${check.label ?? `${check.path} must contain /${check.pattern}/i`}`;
    if (check.type === "file_exists") return `- ${check.label ?? `${check.path} must exist`}`;
    if (check.type === "page_count") return `- ${check.label ?? `Must have at least ${check.count} pages`}`;
    return `- ${check.label ?? "Project-wide requirement"}`;
  });

  return [
    "FORGE-OWNED VERIFICATION REQUIREMENTS",
    "The verifier will enforce these checks after you write files. Build so they pass; do not merely mention them.",
    ...lines,
    "For interactive games, expose a small runtime debug hook on window.__forgeGameDebug with player/camera/controls, colliders, and any NPC/physics objects requested. This hook is for verification and can be lightweight.",
  ].join("\n");
}
