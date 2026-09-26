# DJL agent sandbox: python3 with numpy, pandas, matplotlib, pypdf, python-docx,
# and openpyxl, plus nsjail. The worker creates one throwaway machine per task
# run from this image (see apps/api/src/agent/sandbox/FlyMachines.ts); every
# piece of user code runs inside nsjail with no network (nsjail.cfg).
FROM debian:bookworm-slim AS nsjail
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates make g++ pkg-config \
     libprotobuf-dev protobuf-compiler libnl-route-3-dev bison flex \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 3.4 https://github.com/google/nsjail.git /src/nsjail \
  && make -C /src/nsjail -j4

FROM python:3.12-slim-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends libprotobuf32 libnl-route-3-200 curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir \
  numpy==2.1.3 pandas==2.2.3 matplotlib==3.9.2 pypdf==5.1.0 python-docx==1.1.2 openpyxl==3.1.5
COPY --from=nsjail /src/nsjail/nsjail /usr/local/bin/nsjail
COPY nsjail.cfg extract.py entrypoint run-python fetch-input extract-text /opt/djl/
RUN chmod 755 /opt/djl/entrypoint /opt/djl/run-python /opt/djl/fetch-input /opt/djl/extract-text \
  && chmod 644 /opt/djl/nsjail.cfg /opt/djl/extract.py \
  && mkdir -p /work
ENTRYPOINT ["/opt/djl/entrypoint"]
