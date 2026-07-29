# AI detector model and dataset license audit

This file is an engineering release gate, not legal advice. A model repository's declared license does not by itself prove that every training-data owner granted the uploader commercial redistribution rights. DJL may bundle a detector only after the model code, weights, base model, training data, conversion artifacts, and required notices have all been reviewed.

## Research-only candidates

### DACTYL

- Model: `ShantanuT01/dactyl-ai-text-detector`
- Reviewed revision: `b62b403cb6c5c14751b5b98b474e5f662b41cef9`
- Repository declaration: MIT
- Release decision: **blocked for commercial bundling**

The DACTYL training corpus includes sources whose public terms do not support a clean commercial redistribution chain:

- ELLIPSE student essays are CC BY-NC-SA 4.0.
- The IvyPanda essay mirror declares no dataset license, while IvyPanda's site terms restrict automated collection and redistribution.
- The ISOT collection declares no open dataset license and includes Reuters articles, whose copyright terms restrict redistribution without permission.
- Amazon Reviews 2023 has no declared dataset license.
- The FiveThirtyEight Russian troll tweet corpus has no repository license.
- WritingPrompts distributes Reddit user text without an explicit relicensing grant for that text.

The third-party `GabeuxDev/dactyl-ai-text-detector-onnx` conversion at revision `3d0ac71f103eea057f7443f4ddd7d0c4823cd3ab` inherits the same unresolved training-data chain. Converting weights to ONNX does not cure upstream restrictions.

Primary sources:

- [DACTYL model card](https://huggingface.co/ShantanuT01/dactyl-ai-text-detector)
- [DACTYL dataset](https://huggingface.co/datasets/ShantanuT01/DACTYL)
- [ELLIPSE corpus terms](https://github.com/scrosseye/ELLIPSE-Corpus)
- [IvyPanda terms](https://ivypanda.com/terms-conditions)
- [ISOT dataset description](https://onlineacademiccommunity.uvic.ca/isot/2022/11/27/fake-news-detection-datasets/)
- [Thomson Reuters copyright policy](https://www.thomsonreuters.com/en/policies/copyright)
- [Amazon Reviews 2023 dataset card](https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023)
- [FiveThirtyEight Russian troll tweets](https://github.com/fivethirtyeight/russian-troll-tweets)
- [WritingPrompts distribution page](https://github.com/facebookresearch/fairseq/tree/main/examples/stories)

### Vanguard

- Model: `ShantanuT01/vanguard-ai-text-detector`
- Reviewed revision: `823061be63b90f2b42f64ac1e1f82772e872533b`
- Repository declaration: MIT
- Release decision: **blocked for commercial bundling**

Vanguard was trained on DACTYL 2.0, LLMTrace, and MAGA-Bench. The associated PAN 2026 paper defines its DACTYL-complete training pool as DACTYL v1 plus v2, so Vanguard inherits the unresolved DACTYL v1 sources above. DACTYL v2 also includes MovieSum under CC BY-NC 4.0 and Yelp Open Dataset material whose official page limits use to educational purposes.

Primary sources:

- [Vanguard model card](https://huggingface.co/ShantanuT01/vanguard-ai-text-detector)
- [PAN 2026 system paper](https://arxiv.org/abs/2607.17382)
- [MovieSum dataset card](https://huggingface.co/datasets/rohitsaxena/MovieSum)
- [Yelp Open Dataset terms](https://business.yelp.com/data/resources/open-dataset/)

### ModernBERT RAID + MAGE

- Model: `GeorgeDrayson/modernbert-ai-detection-raid-mage`
- Reviewed model revision: `e047d9c56f51a7e5c5ef5b0dd556f519bb9dd624`
- Reviewed ONNX revision: `6dcd8a3100e75d1224d7222d883bde596113d3f3`
- Repository declaration: Apache-2.0
- Release decision: **blocked pending rights-holder or legal confirmation**

The model card says this detector was fine-tuned on MAGE and RAID. Both dataset repositories publish permissive top-level declarations, but the public records do not establish a complete commercial-rights chain for all of the underlying human-authored text.

The MAGE paper identifies source datasets that include Yelp reviews, XSum BBC news, several Reddit collections, Wikipedia contexts, ROCStories, HellaSwag, SQuAD, and scientific abstracts. MAGE's public metadata is also internally inconsistent: its Hugging Face card and repository license declare Apache-2.0, while its repository README displays CC BY 4.0. Yelp describes its Open Dataset as intended for educational use, and the XSum card records an unknown license for its BBC-derived content. No public sample-level manifest or set of upstream grants demonstrates that the MAGE uploader can relicense every source text for commercial model distribution.

RAID identifies sources including full BBC news articles, IMDb reviews, Reddit posts, PoemHunter poems, Allrecipes recipes, Wikipedia introductions, and CMU book summaries. The RAID repository's MIT declaration does not include a documented grant from every original text owner. BBC's public copyright page limits the described download permission to personal, non-commercial use, and IMDb directs commercial users to licensing. These facts do not prove that the model is unlawful; they mean the public evidence is insufficient for DJL's strict commercial-distribution gate without confirmation from the relevant rights holders or legal review.

The ONNX repository describes an automated conversion of the GeorgeDrayson model. Its Apache-2.0 declaration covers what the repository publisher purports to license; conversion and quantization do not create a new training corpus, establish missing upstream permissions, or expand the rights available in source texts.

Primary sources:

- [ModernBERT model card at the reviewed revision](https://huggingface.co/GeorgeDrayson/modernbert-ai-detection-raid-mage/blob/e047d9c56f51a7e5c5ef5b0dd556f519bb9dd624/README.md)
- [ModernBERT ONNX card at the reviewed revision](https://huggingface.co/onnx-community/modernbert-ai-detection-raid-mage-ONNX/blob/6dcd8a3100e75d1224d7222d883bde596113d3f3/README.md)
- [MAGE dataset card at the reviewed revision](https://huggingface.co/datasets/yaful/MAGE/blob/342663f0a2b775455c023f5d36a1341ff0ec5402/README.md)
- [MAGE repository README](https://github.com/yafuly/MAGE/blob/6d11f851184b9f04166f952ddc1f47727f36710f/README.md)
- [MAGE repository license](https://github.com/yafuly/MAGE/blob/6d11f851184b9f04166f952ddc1f47727f36710f/LICENSE)
- [MAGE paper](https://aclanthology.org/2024.acl-long.3.pdf)
- [Yelp Open Dataset page](https://business.yelp.com/data/resources/open-dataset/)
- [XSum dataset card](https://huggingface.co/datasets/EdinburghNLP/xsum/blob/123a8965fd14fa6d21a1018e623a3fd3ce054dbe/README.md)
- [RAID dataset card at the reviewed revision](https://huggingface.co/datasets/liamdugan/raid/blob/865cac74188466cb0c3b7574a10204007b57a459/README.md)
- [RAID source inventory](https://github.com/liamdugan/raid/blob/47105b9b5808d52c3ee9007ad02733a513f8e780/generation/sources/README.md)
- [RAID paper](https://aclanthology.org/2024.acl-long.674.pdf)
- [BBC copyright page](https://www.bbcworldnews.com/pages/Copyright.aspx)
- [IMDb data-use guidance](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX)

### TMR AI Text Detector

- Original model: `Oxidane/tmr-ai-text-detector`
- Reviewed original-model revision: `0ceddea903015ef99cbaa040a4d8a216aed9c683`
- Production conversion: `onnx-community/tmr-ai-text-detector-ONNX`
- Reviewed production revision: `b9aa251e5bcda7e429fcc936767d921435945b60`
- Repository declaration: MIT
- Release decision: **not cleared for continued commercial bundling pending rights-holder or legal confirmation**

The original model card says TMR was trained on 50,000 stratified RAID samples, with 45% human and 55% AI records. It does not provide an immutable training-sample manifest or identify the exact RAID dataset revision used. As documented above, RAID contains human-authored material from BBC, IMDb, Reddit, PoemHunter, Allrecipes, Wikipedia, and other sources, while the public RAID materials do not document a commercial redistribution grant from every original text owner.

The production ONNX card identifies itself as a quantized conversion of the Oxidane model and repeats the RAID training description. The current DJL production pin is therefore downstream of the same unresolved source chain. The MIT declarations on the original and ONNX model repositories are relevant to the artifacts the publishers purport to license, but they are not evidence that all upstream text owners granted commercial training or model-redistribution rights. ONNX conversion does not cure that evidentiary gap.

Primary sources:

- [TMR original model card at the reviewed revision](https://huggingface.co/Oxidane/tmr-ai-text-detector/blob/0ceddea903015ef99cbaa040a4d8a216aed9c683/README.md)
- [TMR production ONNX card at the reviewed revision](https://huggingface.co/onnx-community/tmr-ai-text-detector-ONNX/blob/b9aa251e5bcda7e429fcc936767d921435945b60/README.md)
- [RAID dataset card at the reviewed revision](https://huggingface.co/datasets/liamdugan/raid/blob/865cac74188466cb0c3b7574a10204007b57a459/README.md)
- [RAID source inventory](https://github.com/liamdugan/raid/blob/47105b9b5808d52c3ee9007ad02733a513f8e780/generation/sources/README.md)
- [BBC copyright page](https://www.bbcworldnews.com/pages/Copyright.aspx)
- [IMDb data-use guidance](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX)

### AIGC Detector ZH v3

- Original model: `yuchuantian/AIGC_detector_zhv3`
- Reviewed original-model revision: `47695ff451b32c225dd938f4f478f7fdc6aa6bb0`
- Production conversion: `Eslzzyl/aigc-detector-zh-onnx`
- Reviewed production revision: `e6c77fd62955fac134e76deb5396806f6d35fd30`
- Repository declaration: Apache-2.0 metadata
- Release decision: **not cleared for continued commercial bundling pending provenance and legal confirmation**

The original repository's entire model card is only the Apache-2.0 metadata declaration. It provides no training-data inventory, dataset revisions, generation models, evaluation protocol, intended-use limits, base-model attribution, or artifact provenance. Its config identifies the local base path as `chinese-roberta-wwm-ext`, but the repository does not document the exact base checkpoint revision or the rights and notices that must accompany it. The original repository also has no checked-in `LICENSE` or `NOTICE` file; DJL's manifest now links to the immutable README metadata instead of the nonexistent `LICENSE` URL it previously exposed.

The production repository states that it exported and dynamically quantized that model, documents the two-logit label order, and supplies the ONNX artifact. Those facts are useful for engineering verification but do not identify the fine-tuning corpus or establish rights in it. Quantization cannot supply the missing training-data provenance or Apache notice materials. The public record is therefore insufficient for DJL's strict commercial gate even though the repository metadata says Apache-2.0.

Primary sources:

- [Original model metadata at the reviewed revision](https://huggingface.co/yuchuantian/AIGC_detector_zhv3/blob/47695ff451b32c225dd938f4f478f7fdc6aa6bb0/README.md)
- [Original config at the reviewed revision](https://huggingface.co/yuchuantian/AIGC_detector_zhv3/blob/47695ff451b32c225dd938f4f478f7fdc6aa6bb0/config.json)
- [Production ONNX model card at the reviewed revision](https://huggingface.co/Eslzzyl/aigc-detector-zh-onnx/blob/e6c77fd62955fac134e76deb5396806f6d35fd30/README.md)

### Fakespot / ApolloDFT

- Model: `fakespot-ai/roberta-base-ai-text-detection-v1`
- Reviewed model revision: `f9cdb14d1f8b105f597d80fa7b56f20c6ea0e9db`
- Reviewed ApolloDFT repository revision: `2a752b9cf569c9da68c3ef397e8d4735485a1726`
- Repository declaration: Apache-2.0
- Release decision: **blocked pending provenance documentation and rights-holder or legal confirmation**

The Fakespot model card points to ApolloDFT for its technical details. ApolloDFT's technical report says the supervised detector began with RAID and was expanded with public datasets and generated text. Its source list includes RAID, Amazon Reviews 2023, CHEAT, GPT-Sentinel, MGTBench, TuringBench, Ghostbuster, HC3, TweepFake, and other corpora.

This chain inherits RAID's unresolved original-text permissions. Amazon Reviews 2023 has no declared dataset license, and its maintainer states publicly that the team is not in a position to assign one and that the dataset was made primarily for research. ApolloDFT's public files do not provide an immutable sample-level training manifest, per-source quantities and licenses, or a mapping from the released model revision to exact dataset snapshots. The Apache-2.0 declarations on the Fakespot model and ApolloDFT code therefore do not by themselves establish commercial rights in all upstream training texts. Public evidence is insufficient to approve bundled distribution unless the publisher supplies an adequate provenance record and applicable rights assurances, or legal review accepts the remaining uncertainty.

Primary sources:

- [Fakespot model card at the reviewed revision](https://huggingface.co/fakespot-ai/roberta-base-ai-text-detection-v1/blob/f9cdb14d1f8b105f597d80fa7b56f20c6ea0e9db/README.md)
- [ApolloDFT technical report at the reviewed revision](https://github.com/FakespotAILabs/ApolloDFT/blob/2a752b9cf569c9da68c3ef397e8d4735485a1726/apollo-text.md)
- [ApolloDFT source-data inventory at the reviewed revision](https://github.com/FakespotAILabs/ApolloDFT/blob/2a752b9cf569c9da68c3ef397e8d4735485a1726/data/README.md)
- [ApolloDFT Apache-2.0 license](https://github.com/FakespotAILabs/ApolloDFT/blob/2a752b9cf569c9da68c3ef397e8d4735485a1726/LICENSE)
- [Amazon Reviews 2023 dataset card](https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023)
- [Amazon Reviews 2023 licensing discussion](https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023/discussions/1)

All candidates in this section may remain internal research comparators. They must not be placed in the production manifest, downloaded by the released application, or used to make a public DJL accuracy claim unless the missing commercial permissions or an adequate legal approval are supplied and reviewed.

### ELECTRA-small with TXD-22 fine-tuning

- Base model: `google/electra-small-discriminator`
- Reviewed base-model revision: `fa8239aadc095e9164941d05878b98afe9b953c3`
- Reviewed PyTorch weight SHA-256: `735154b1a8a78ba97da3c8c53c2e3d1d58b8dec5fa5caf0e144661c8bbe0e787`
- Proposed fine-tuning data: TXD-22 V1, DOI `10.17632/prcjcggtjf.1`
- Repository declarations: Apache-2.0 base model; CC BY 4.0 fine-tuning dataset
- Release decision: **internal challenger only, pending provenance and legal approval**

The base-model card declares Apache-2.0, and Google's fixed ELECTRA source repository contains the Apache-2.0 license. The public Hugging Face model repository does not include its own license or notice file, so a downstream bundle would need to carry the upstream license and explicit attribution.

TXD-22-only describes the proposed fine-tuning data, not all data embodied in the model. Google's release identifies this checkpoint with ELECTRA-Small++, while the ELECTRA paper says Small++ used the XLNet pretraining corpus: Wikipedia, BooksCorpus, Giga5, ClueWeb 2012-B, and Common Crawl. Google's README also says the corpus used in the paper is not publicly available. The public record therefore does not provide an immutable source manifest or a complete commercial-rights chain for the base model's pretraining text.

TXD-22 V1 publishes a CC BY 4.0 version-level license, but its CSV has no human-author identifiers, exact generator versions, or component-level provenance for mixed/refined answers. Mendeley's license metadata also warns that third-party content can require additional permission. Public evidence does not independently establish the contributor-consent and provider-output chain for all TXD-22 records.

This candidate is technically attractive for an internal experiment: ELECTRA-small has about 14 million parameters, its sequence-classification architecture is supported by DJL's pinned Transformers.js runtime, and a quantized ONNX artifact is expected to be much smaller than the current English detector. These engineering advantages do not satisfy the separate provenance gate. The model must not enter the production manifest unless its final quantized artifact passes external author-disjoint evaluation and product/legal review accepts both residual source chains.

Primary sources:

- [ELECTRA-small model card at the reviewed revision](https://huggingface.co/google/electra-small-discriminator/blob/fa8239aadc095e9164941d05878b98afe9b953c3/README.md)
- [Google ELECTRA source license](https://github.com/google-research/electra/blob/8a46635f32083ada044d7e9ad09604742600ee7b/LICENSE)
- [Google ELECTRA release README](https://github.com/google-research/electra/blob/8a46635f32083ada044d7e9ad09604742600ee7b/README.md)
- [ELECTRA paper](https://openreview.net/pdf?id=r1xMH1BtvB)
- [TXD-22 V1](https://doi.org/10.17632/prcjcggtjf.1)

## Candidate approval checklist

Before changing `apps/server/src/aiDetector/modelManifest.ts`, record:

1. Immutable model and conversion revisions.
2. Model, base-model, tokenizer, and code licenses.
3. Every training/evaluation dataset, its immutable revision, and its original rather than mirrored license.
4. Any noncommercial, share-alike, educational-only, no-license, scraped, or proprietary source.
5. Generation-provider terms applicable when synthetic records were created.
6. Required attribution and notice files.
7. ONNX exporter identity, source revision, numerical-equivalence evidence, and artifact checksums.
8. Written product/legal approval for any unresolved source.

Accuracy cannot override this gate. If provenance is incomplete, the candidate remains research-only even when it wins the benchmark.
