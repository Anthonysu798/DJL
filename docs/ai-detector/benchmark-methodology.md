# Benchmark methodology

Release evaluation must use independently reviewed, license-safe English and Simplified Chinese datasets with human and AI provenance, stable dataset hashes, and documented domain composition. Split evaluation by language, source domain, length band, native/non-native writing where lawful and ethical, model family, editing/paraphrase level, and mixed authorship.

Record model/tokenizer hashes, runtime version, preprocessing/calibration/segmentation versions, OS/architecture/CPU/memory, dataset hashes/counts/licenses, confusion matrices, per-class precision/recall/F1, uncertainty rate, eligible coverage, failures, latency percentiles, throughput, and peak RSS. Uncertain is an abstention, not silently a wrong or correct binary result. Publish both selective accuracy and coverage.

The release holdout streams revision-pinned HC3 records into the harness without persisting source text. It uses paired human and ChatGPT answers, balances labels and languages, records every source configuration and license, and fails if an upstream repository revision changes. Calibration must use a disjoint sample from final release evaluation; the current small HC3 run is a conservative safety check, not an independent or domain-representative validation.

Run the checked-in harness twice and require identical predictions/percentages. The synthetic smoke fixture validates plumbing only. A production accuracy claim requires a larger representative external corpus, documented thresholds, domain/length/native-language and editing slices, false-positive review (especially student and non-native writing), and independent product/legal review.
