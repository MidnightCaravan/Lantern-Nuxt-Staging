        if url.path.startswith("/media/"):
            key = url.path[len("/media/"):]
            range_header = request.headers.get("Range")

            extension = key.rsplit(".", 1)[-1].lower() if "." in key else ""
            content_types = {
                "png": "image/png",
                "jpg": "image/jpeg",
                "jpeg": "image/jpeg",
                "webp": "image/webp",
                "gif": "image/gif",
                "mp4": "video/mp4",
                "webm": "video/webm",
                "mov": "video/quicktime",
            }
            content_type = content_types.get(
                extension, "application/octet-stream"
            )
            is_video = content_type.startswith("video/")

            total_size = None
            range_start = None
            range_end = None

            try:
                if is_video and range_header:
                    # Retrieve the full object's metadata before calculating
                    # an explicit offset and length for the R2 range read.
                    metadata = await self.env.lantern_media.head(key)
                    if metadata is None:
                        return Response("Media not found.", status=404)

                    total_size = getattr(metadata, "size", None)
                    if total_size is None:
                        return Response("Video size unavailable.", status=502)
                    total_size = int(total_size)

                    match = re.fullmatch(
                        r"bytes=(\d*)-(\d*)",
                        range_header.strip(),
                    )
                    if not match or (
                        not match.group(1) and not match.group(2)
                    ):
                        return Response(
                            "Invalid byte range.",
                            status=416,
                            headers={"Content-Range": f"bytes */{total_size}"},
                        )

                    first, last = match.groups()
                    try:
                        if first:
                            range_start = int(first)
                            range_end = (
                                min(int(last), total_size - 1)
                                if last else total_size - 1
                            )
                        else:
                            suffix_length = int(last)
                            if suffix_length < 1:
                                return Response(
                                    "Invalid byte range.",
                                    status=416,
                                    headers={
                                        "Content-Range": f"bytes */{total_size}"
                                    },
                                )
                            range_start = max(
                                total_size - suffix_length, 0
                            )
                            range_end = total_size - 1
                    except ValueError:
                        return Response(
                            "Invalid byte range.",
                            status=416,
                            headers={"Content-Range": f"bytes */{total_size}"},
                        )

                    if (
                        total_size == 0
                        or range_start >= total_size
                        or range_end < range_start
                    ):
                        return Response(
                            "Range not satisfiable.",
                            status=416,
                            headers={"Content-Range": f"bytes */{total_size}"},
                        )

                    requested_length = range_end - range_start + 1

                    # Do not ask R2 to interpret the incoming Headers object.
                    obj = await self.env.lantern_media.get(
                        key,
                        range={
                            "offset": range_start,
                            "length": requested_length,
                        },
                    )
                elif range_header:
                    obj = await self.env.lantern_media.get(
                        key, range=request.headers
                    )
                else:
                    obj = await self.env.lantern_media.get(key)

            except Exception as exc:
                print("R2 media read failed:", exc)
                return Response("Media unavailable.", status=502)

            if obj is None:
                return Response("Media not found.", status=404)

            headers = {
                "Content-Type": content_type,
                "Cache-Control": "public, max-age=31536000",
            }
            status = 200

            if is_video:
                headers["Accept-Ranges"] = "bytes"
                if total_size is None:
                    total_size = getattr(obj, "size", None)

                if total_size is not None:
                    headers["Content-Length"] = str(total_size)

                if range_start is not None:
                    actual_length = range_end - range_start + 1
                    headers["Content-Range"] = (
                        f"bytes {range_start}-{range_end}/{total_size}"
                    )
                    headers["Content-Length"] = str(actual_length)
                    status = 206

            # Preserve the native R2 ReadableStream in the production Worker.
            try:
                from js import JSON as JSJSON, Response as JSResponse

                response_init = JSJSON.parse(
                    json.dumps({"status": status, "headers": headers})
                )
                return JSResponse.new(obj.body, response_init)
            except ImportError:
                return Response(obj.body, status=status, headers=headers)