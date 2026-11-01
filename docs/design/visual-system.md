# Analytica visual system

Analytica shares MZML's identity while giving reports the space and density of a working analytics tool. The reference is the local `mzml.dev` project, especially its current hero, root font definitions, and landing page design system.

## Palette and typography

| Role                       | Value     |
| -------------------------- | --------- |
| Crimson and primary action | `#cb173f` |
| Action hover               | `#b01336` |
| Crimson tint               | `#fbecef` |
| Charcoal text              | `#333939` |
| White panels               | `#ffffff` |
| Subtle ground              | `#f7f8f9` |

Headings and the wordmark use Plus Jakarta Sans. Body text and the interface use Lexend. Both fonts are served locally as variable WOFF2 files, with their SIL Open Font Licenses in `public/fonts`. Code examples retain the system monospace font.

`product.css` owns shared tokens, Kumo theme integration, account screens, and console extensions. `marketing.css` owns public pages and their responsive layouts. `styles.css` contains the underlying report and application layouts.

Kumo computes emphasis colors inside each button. Set its `--color-kumo-brand` token, rather than only overriding the inherited button background. Its emphasis overlay uses the final variant color as a flat fill, preserving destructive variants.

## Composition

The landing page demonstrates the product before explaining it. Its crimson field and typography connect it to MZML. The report uses the actual deterministic demo dataset, explicitly labeled as sample data. Changing the project or date range updates totals, sources, the chart, and the link into the full demo.

```text
Desktop                          Phone
Brand / navigation / account     Brand / account / menu
Crimson field                    Crimson field
  Heading       Copy + actions     Heading
  Full-width interactive report    Copy + actions
                                   Report + source list
Project story / project links    Project story, then links
Privacy story / mode control     Privacy story, then control
Setup story / setup steps        Setup story, then steps
Questions / expandable answers   Questions and answers
Closing action                   Closing action
Large wordmark and useful links  Wordmark and useful links
```

The page's claims have direct evidence:

- Separate product reports: the project selector and sample-project links.
- Useful traffic information: report totals, a daily chart, and source breakdowns.
- Explicit collection choices: a working privacy-mode comparison with installation code.
- A clear setup path: account, project, and installation instructions linked to the guide.

The design-taste direction is “The product performs.” The supplied alternative CTA becomes a plain invitation because registration happens in the real account flow. The footer uses the wordmark rather than tiles containing nonexistent contact information. Native FAQ disclosure tiles keep every answer available with keyboard and touch. The main direction's readable interface takes precedence over its optional sticky media reel, which conflicts with MZML's crimson hero and the product's report controls.

Product imagery consists of three functional interface fragments. Stock photographs and video do not explain this product. Motion is limited to a short hero entrance and control feedback, with reduced motion respected.

## Accessibility and maintenance

Public body copy starts at 16px. Forms, report fragments, and navigation retain smaller interface sizes. Keep long copy within its existing measure. Use the shared colors for new controls and charts; retain semantic success, warning, and error colors.

The public header has an expandable mobile menu. Privacy tabs support arrow keys, Home, End, selection, focus, and panel relationships. Report totals announce changes. Public pages include a skip link and visible keyboard focus.

Run the existing browser suite after changing these interactions. Check public pages, signup, projects, and reports at phone, tablet, and desktop widths. Verify that demo labels, privacy explanations, usage limits, and account deletion details remain accurate.
