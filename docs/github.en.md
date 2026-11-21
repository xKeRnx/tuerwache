# GitHub, licensing and business model

## What you can publish

Türwache can run free of charge in a private household. The source can be read publicly and shared free of charge under the private-use license. If you modify a version, publish the corresponding source under the same license, even for purely private use. Sale, paid hosting, business use and distribution as part of a paid bundle are prohibited. See the [license text](../LICENSE.md) for the full terms.

Describe the GitHub repository as source available for private use. The [Open Source Initiative](https://opensource.org/definition-annotated) requires commercial use to be permitted. A public GitHub repository can be viewed and forked through GitHub. [GitHub licensing documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)

For home users, see [local operation and setup assistance](saas.en.md).

## Release preparation

- Clearly identify the rightsholder and a licensing contact. Before publication, have the custom license reviewed, especially the duty to publish purely private changes and how the terms are incorporated. [German Copyright Act, section 31](https://www.gesetze-im-internet.de/urhg/__31.html) · [German Civil Code, sections 305](https://www.gesetze-im-internet.de/bgb/__305.html) and [307](https://www.gesetze-im-internet.de/bgb/__307.html)
- Record the terms under which outside contributions can be accepted. Previously granted rights remain subject to their original terms.
- Keep third-party notices. Expo templates, FFmpeg, AI models and other dependencies have their own terms. Review redistribution rights before distributing compiled packages.
- Export the repository to a new empty folder. The source allowlist excludes runtime data, private settings and keys. Review the result for credentials and private files before publication.

```sh
node scripts/prepare-repository.mjs --public --destination /path/to/new-github-export
```

The public export includes example documentation screenshots. Photos used by optional AI tests are kept outside the export. The guides are available in the app under **System → Documentation**. The Türwache website serves the same material at `/dokumentation/`.
