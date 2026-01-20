FROM python:3.12-slim AS build

WORKDIR /site

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY mkdocs.yml ./mkdocs.yml
COPY docs ./docs

RUN mkdocs build --clean --strict

FROM nginx:1.27-alpine

COPY --from=build /site/site /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8000

CMD ["nginx", "-g", "daemon off;"]
