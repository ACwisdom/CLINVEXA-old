const path = require('path')
const desktopPackage = require('../../apps/desktop/package.json')

const repoRoot = path.resolve(__dirname, '../..')

module.exports = {
  ...desktopPackage.build,
  appId: 'com.clinvexa.desktop',
  artifactName: 'CLINVEXA-${version}-${os}-${arch}.${ext}',
  executableName: 'CLINVEXA',
  extraResources: [
    // Keep the offline dependency archives and install stamp from the desktop
    // build, but replace its broad Source A copy with the single curated copy
    // below.  Copying the repository twice reintroduced excluded development
    // trees, caused intermittent EBUSY failures, and made it possible for stale
    // files to survive in a release directory.
    ...desktopPackage.build.extraResources.filter(resource => resource.to !== 'clinvexa-runtime'),
    {
      from: repoRoot,
      to: 'clinvexa-runtime',
      filter: [
        '**/*',
        '!node_modules{,/**}',
        '!venv{,/**}',
        '!.venv{,/**}',
        '!**/.venv{,/**}',
        '!apps/desktop{,/**}',
        '!apps/bootstrap-installer{,/**}',
        '!tests{,/**}',
        '!tests-js{,/**}',
        '!website{,/**}',
        '!web{,/**}',
        '!docs{,/**}',
        '!artifacts{,/**}',
        '!benchmarks{,/**}',
        '!contributors{,/**}',
        '!LICENSE',
        '!.git{,/**}',
        '!.github{,/**}',
        '!.mailmap',
        '!.pytest_cache{,/**}',
        '!.ruff_cache{,/**}',
        '!.runtime{,/**}',
        '!.plans{,/**}',
        '!release{,/**}',
        '!tmp{,/**}',
        '!%SystemDrive%{,/**}',
        '!**/__pycache__/**',
        '!**/*.pyc'
      ]
    },
    {
      from: path.join(repoRoot, 'docs', 'CLINVEXA-用户安装与使用指南.md'),
      to: 'clinvexa-runtime/docs/CLINVEXA-用户安装与使用指南.md'
    },
    {
      from: path.join(repoRoot, 'docs', 'CLINVEXA-医疗场景与功能介绍.md'),
      to: 'clinvexa-runtime/docs/CLINVEXA-医疗场景与功能介绍.md'
    }
  ],
  extraMetadata: {
    name: 'clinvexa',
    productName: 'CLINVEXA',
    description: 'CLINVEXA desktop shell.'
  },
  productName: 'CLINVEXA',
  protocols: [
    {
      name: 'CLINVEXA Protocol',
      schemes: ['clinvexa']
    }
  ],
  win: {
    ...desktopPackage.build.win,
    // CLINVEXA has one supported Windows delivery artifact.  Keeping MSI
    // enabled here duplicated the installer entry point and made every
    // offline release spend a long time relinking the multi-gigabyte runtime.
    target: ['nsis'],
    legalTrademarks: 'CLINVEXA'
  },
  nsis: {
    ...desktopPackage.build.nsis,
    shortcutName: 'CLINVEXA',
    uninstallDisplayName: 'CLINVEXA'
  }
}
