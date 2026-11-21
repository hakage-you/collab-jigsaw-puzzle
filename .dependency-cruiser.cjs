/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies between modules are forbidden.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'Every module under src/ must be reachable from src/ui/main.js.',
      from: {
        orphan: true,
        path: '^src/',
        pathNot: '^src/ui/main\\.js$',
      },
      to: {},
    },
    {
      name: 'config-no-deps',
      severity: 'error',
      comment: 'src/config/** must not depend on any other layer.',
      from: { path: '^src/config/' },
      to: { path: '^src/', pathNot: '^src/config/' },
    },
    {
      name: 'core-only-core-and-config',
      severity: 'error',
      comment: 'src/core/** may only import src/core/** and src/config/**.',
      from: { path: '^src/core/' },
      to: { path: '^src/', pathNot: '^src/(core|config)/' },
    },
    {
      name: 'services-no-net-app-ui',
      severity: 'error',
      comment: 'src/services/** must not import net, app, or ui layers.',
      from: { path: '^src/services/' },
      to: { path: '^src/(net|app|ui)/' },
    },
    {
      name: 'net-no-app-or-ui',
      severity: 'error',
      comment: 'src/net/** must not import app or ui layers.',
      from: { path: '^src/net/' },
      to: { path: '^src/(app|ui)/' },
    },
    {
      name: 'render-only-core-and-config',
      severity: 'error',
      comment:
        'src/render/** draws the puzzle: it may only import src/render/**, src/core/** and src/config/**.',
      from: { path: '^src/render/' },
      to: { path: '^src/', pathNot: '^src/(render|core|config)/' },
    },
    {
      name: 'only-ui-uses-render',
      severity: 'error',
      comment:
        'Only src/ui/** may import src/render/** (core, services, net and app must not draw).',
      from: { path: '^src/(config|core|services|net|app)/' },
      to: { path: '^src/render/' },
    },
    {
      name: 'app-no-ui',
      severity: 'error',
      comment: 'src/app/** must not import src/ui/**.',
      from: { path: '^src/app/' },
      to: { path: '^src/ui/' },
    },
    {
      name: 'ui-no-core-or-net',
      severity: 'error',
      comment:
        'src/ui/** must interact via src/app/** and must not import src/core/** or src/net/** directly.',
      from: { path: '^src/ui/' },
      to: { path: '^src/(core|net)/' },
    },
    {
      name: 'main-only-app-and-ui',
      severity: 'error',
      comment: 'src/ui/main.js may only import src/app/** and src/ui/**.',
      from: { path: '^src/ui/main\\.js$' },
      to: { path: '^src/', pathNot: '^src/(app|ui)/' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules|vendor',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default'],
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)',
      },
    },
  },
};
