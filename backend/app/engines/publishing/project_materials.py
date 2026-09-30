from __future__ import annotations

import sqlite3
import uuid
from contextlib import closing
from pathlib import Path
from typing import Callable

from app.config import DB_PATH
from app.database import connect_database
from app.engines.publishing.models import MaterialCover, ProjectMaterial
from app.engines.publishing.material_copy import sanitize_copy_html, validate_copy_title
from app.engines.publishing.project_memberships import (
    ProjectNotFound,
    ProjectPermissionDenied,
)
from app.storage_schema import resolve_user_organization_id


_connection_factory: Callable[[], sqlite3.Connection] = lambda: connect_database(DB_PATH)
_schema_initializer: Callable[[], None] = lambda: None
_clock: Callable[[], str] = lambda: ""


def configure(
    connection_factory: Callable[[], sqlite3.Connection],
    schema_initializer: Callable[[], None],
    clock: Callable[[], str],
) -> None:
    global _connection_factory, _schema_initializer, _clock
    _connection_factory = connection_factory
    _schema_initializer = schema_initializer
    _clock = clock


def project_material_access(
    conn: sqlite3.Connection,
    user_id: str,
    project_id: str,
) -> sqlite3.Row:
    organization_id = resolve_user_organization_id(conn, user_id)
    access = conn.execute("""
        SELECT project.organization_id, membership.role
        FROM content_projects project
        JOIN project_memberships membership
          ON membership.project_id = project.id
         AND membership.user_id = ?
        WHERE project.id = ? AND project.organization_id = ?
    """, (user_id, project_id, organization_id)).fetchone()
    if access is None:
        raise ProjectNotFound("Project not found")
    return access


def ensure_project_material_access(
    user_id: str, project_id: str, material_set_id: str | None = None,
) -> str:
    _schema_initializer()
    with closing(_connection_factory()) as conn:
        access = project_material_access(conn, user_id, project_id)
        if material_set_id is not None:
            _validate_material_set(conn, project_id, material_set_id)
        return access["organization_id"]


def _row_to_material(row: sqlite3.Row) -> ProjectMaterial:
    return ProjectMaterial(**dict(row))


def _material_set_counts(conn: sqlite3.Connection, project_id: str) -> dict[str, dict[str, int]]:
    rows = conn.execute("""
        SELECT parent_id, COUNT(*) AS material_count,
               SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END) AS image_count,
               SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) AS video_count,
               SUM(CASE WHEN media_type = 'document' THEN 1 ELSE 0 END) AS document_count
        FROM project_materials
        WHERE project_id = ? AND node_type = 'file'
        GROUP BY parent_id
    """, (project_id,)).fetchall()
    return {
        row["parent_id"]: {
            "material_count": row["material_count"],
            "image_count": row["image_count"],
            "video_count": row["video_count"],
            "document_count": row["document_count"],
        }
        for row in rows
    }


def _validate_material_set(
    conn: sqlite3.Connection,
    project_id: str,
    material_set_id: str,
) -> None:
    material_set = conn.execute(
        "SELECT 1 FROM project_materials "
        "WHERE id = ? AND project_id = ? AND parent_id = '' "
        "AND node_type = 'collection'",
        (material_set_id, project_id),
    ).fetchone()
    if material_set is None:
        raise LookupError("Material set not found")


def _material_set_covers(conn: sqlite3.Connection, project_id: str) -> dict[str, list[MaterialCover]]:
    rows = conn.execute("""
        SELECT id, parent_id, media_type, object_key FROM (
            SELECT id, parent_id, media_type, object_key,
                   ROW_NUMBER() OVER (
                       PARTITION BY parent_id ORDER BY created_at DESC, id DESC
                   ) AS position
            FROM project_materials
            WHERE project_id = ? AND node_type = 'file'
              AND media_type IN ('image', 'video') AND object_key != ''
        ) ranked
        WHERE position <= 3 ORDER BY parent_id, position
    """, (project_id,)).fetchall()
    covers: dict[str, list[MaterialCover]] = {}
    for row in rows:
        covers.setdefault(row["parent_id"], []).append(MaterialCover(
            id=row["id"], media_type=row["media_type"], object_key=row["object_key"],
        ))
    return covers


def list_project_materials(
    user_id: str,
    project_id: str,
    material_set_id: str = "",
) -> list[ProjectMaterial]:
    _schema_initializer()
    with closing(_connection_factory()) as conn:
        project_material_access(conn, user_id, project_id)
        if material_set_id:
            _validate_material_set(conn, project_id, material_set_id)
            node_filter = "material.node_type = 'file'"
        else:
            node_filter = (
                "material.node_type = 'collection' AND material.parent_id = ''"
            )
        rows = conn.execute(f"""
            SELECT material.*,
                   COALESCE(NULLIF(creator.nickname, ''), creator.username, '')
                       AS creator_name,
                   COALESCE(creator.avatar_url, '') AS creator_avatar_url
            FROM project_materials material
            LEFT JOIN users creator ON creator.id = material.created_by_user_id
            WHERE material.project_id = ? AND material.parent_id = ?
              AND {node_filter}
            ORDER BY lower(material.name), material.id
        """, (project_id, material_set_id)).fetchall()
        counts = _material_set_counts(conn, project_id) if not material_set_id else {}
        covers = _material_set_covers(conn, project_id) if not material_set_id else {}
        return [
            _row_to_material(row).model_copy(update={
                **counts.get(row["id"], {}), "covers": covers.get(row["id"], []),
            })
            for row in rows
        ]


def create_project_material_set(
    user_id: str,
    project_id: str,
    *,
    name: str,
) -> ProjectMaterial:
    _schema_initializer()
    material_set_id = uuid.uuid4().hex[:12]
    normalized_name = name.strip()
    if not normalized_name or "/" in normalized_name or "\\" in normalized_name:
        raise ValueError("Material set name is invalid")
    now = _clock()
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        project_material_access(conn, user_id, project_id)
        try:
            conn.execute(
                """
                INSERT INTO project_materials (
                    id, project_id, parent_id, node_type, name, media_type,
                    mime_type, file_size, object_key, created_by_user_id,
                    created_at, updated_at
                ) VALUES (?, ?, '', 'collection', ?, 'document', '', 0, '', ?, ?, ?)
                """,
                (
                    material_set_id, project_id, normalized_name,
                    user_id, now, now,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("A material set with this name already exists") from exc
        row = conn.execute("""
            SELECT material.*,
                   COALESCE(NULLIF(creator.nickname, ''), creator.username, '')
                       AS creator_name,
                   COALESCE(creator.avatar_url, '') AS creator_avatar_url
            FROM project_materials material
            LEFT JOIN users creator ON creator.id = material.created_by_user_id
            WHERE material.id = ?
        """, (material_set_id,)).fetchone()
        return _row_to_material(row)


def create_project_material(
    user_id: str,
    project_id: str,
    *,
    name: str,
    media_type: str,
    mime_type: str,
    file_size: int,
    object_key: str,
    material_set_id: str,
    strip_extension: bool = True,
    content_html: str | None = None,
) -> ProjectMaterial:
    _schema_initializer()
    if not material_set_id:
        raise ValueError("Material set is required")
    normalized_name = Path(name.strip()).stem.strip() if strip_extension else name.strip()
    if not normalized_name or "/" in normalized_name or "\\" in normalized_name:
        raise ValueError("Material name is invalid")
    if content_html is not None:
        normalized_name = validate_copy_title(normalized_name)
        content_html = sanitize_copy_html(content_html)
        media_type, mime_type = "document", "text/html"
        file_size = len(content_html.encode("utf-8"))
    material_id = uuid.uuid4().hex[:12]
    now = _clock()
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        project_material_access(conn, user_id, project_id)
        _validate_material_set(conn, project_id, material_set_id)
        suffix = 0
        while True:
            candidate_name = (
                normalized_name if suffix == 0 else f"{normalized_name} ({suffix})"
            )
            inserted = conn.execute(
                """
                INSERT INTO project_materials (
                    id, project_id, parent_id, node_type, name, media_type,
                    mime_type, file_size, object_key, created_by_user_id,
                    created_at, updated_at, content_html
                ) VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (project_id, parent_id, name) DO NOTHING
                RETURNING id
                """,
                (
                    material_id, project_id, material_set_id, candidate_name,
                    media_type, mime_type, file_size, object_key, user_id,
                    now, now, content_html,
                ),
            ).fetchone()
            if inserted is not None:
                break
            suffix += 1
        row = conn.execute("""
            SELECT material.*,
                   COALESCE(NULLIF(creator.nickname, ''), creator.username, '')
                       AS creator_name,
                   COALESCE(creator.avatar_url, '') AS creator_avatar_url
            FROM project_materials material
            LEFT JOIN users creator ON creator.id = material.created_by_user_id
            WHERE material.id = ?
        """, (material_id,)).fetchone()
        return _row_to_material(row)


def get_project_material(user_id: str, project_id: str, material_id: str) -> ProjectMaterial:
    _schema_initializer()
    with closing(_connection_factory()) as conn:
        project_material_access(conn, user_id, project_id)
        row = conn.execute(
            "SELECT * FROM project_materials "
            "WHERE id = ? AND project_id = ? AND node_type = 'file'",
            (material_id, project_id),
        ).fetchone()
        if row is None:
            raise LookupError("Project material not found")
        return _row_to_material(row)


def update_project_material_set(
    user_id: str,
    project_id: str,
    material_set_id: str,
    *,
    name: str,
) -> ProjectMaterial:
    _schema_initializer()
    normalized_name = name.strip()
    if not normalized_name or "/" in normalized_name or "\\" in normalized_name:
        raise ValueError("Material set name is invalid")
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        access = project_material_access(conn, user_id, project_id)
        material_set = conn.execute(
            "SELECT created_by_user_id FROM project_materials "
            "WHERE id = ? AND project_id = ? AND parent_id = '' "
            "AND node_type = 'collection'",
            (material_set_id, project_id),
        ).fetchone()
        if material_set is None:
            raise LookupError("Material set not found")
        if (
            material_set["created_by_user_id"] != user_id
            and access["role"] not in {"owner", "admin"}
        ):
            raise ProjectPermissionDenied(
                "Only the material set creator and project managers can rename it",
            )
        try:
            conn.execute(
                "UPDATE project_materials SET name = ?, updated_at = ? WHERE id = ?",
                (normalized_name, _clock(), material_set_id),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("A material set with this name already exists") from exc
        row = conn.execute("""
            SELECT material.*,
                   COALESCE(NULLIF(creator.nickname, ''), creator.username, '')
                       AS creator_name,
                   COALESCE(creator.avatar_url, '') AS creator_avatar_url
            FROM project_materials material
            LEFT JOIN users creator ON creator.id = material.created_by_user_id
            WHERE material.id = ?
        """, (material_set_id,)).fetchone()
        return _row_to_material(row).model_copy(
            update=_material_set_counts(conn, project_id).get(material_set_id, {}),
        )


def update_project_material(
    user_id: str,
    project_id: str,
    material_id: str,
    *,
    name: str | None = None,
    content_html: str | None = None,
) -> ProjectMaterial:
    _schema_initializer()
    normalized_name = name.strip() if name is not None else ""
    if content_html is not None and name is not None:
        raise ValueError("Content updates cannot rename materials")
    if content_html is None and (
        not normalized_name or "/" in normalized_name or "\\" in normalized_name
    ):
        raise ValueError("Material name is invalid")
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        access = project_material_access(conn, user_id, project_id)
        material = conn.execute(
            "SELECT created_by_user_id, media_type FROM project_materials "
            "WHERE id = ? AND project_id = ? AND node_type = 'file'",
            (material_id, project_id),
        ).fetchone()
        if material is None:
            raise LookupError("Project material not found")
        if (
            material["created_by_user_id"] != user_id
            and access["role"] not in {"owner", "admin"}
        ):
            action = "edit its content" if content_html is not None else "rename it"
            raise ProjectPermissionDenied(
                f"Only the material creator and project managers can {action}",
            )
        if content_html is not None:
            if material["media_type"] != "document":
                raise ValueError("Only document materials have editable content")
            content_html = sanitize_copy_html(content_html)
        try:
            if content_html is None:
                conn.execute(
                    "UPDATE project_materials SET name = ?, updated_at = ? WHERE id = ?",
                    (normalized_name, _clock(), material_id),
                )
            else:
                conn.execute(
                    "UPDATE project_materials SET updated_at = ?, "
                    "content_html = ?, mime_type = 'text/html', file_size = ? WHERE id = ?",
                    (
                        _clock(), content_html,
                        len(content_html.encode("utf-8")), material_id,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise ValueError("A material with this name already exists") from exc
        row = conn.execute("""
            SELECT material.*,
                   COALESCE(NULLIF(creator.nickname, ''), creator.username, '')
                       AS creator_name,
                   COALESCE(creator.avatar_url, '') AS creator_avatar_url
            FROM project_materials material
            LEFT JOIN users creator ON creator.id = material.created_by_user_id
            WHERE material.id = ?
        """, (material_id,)).fetchone()
        return _row_to_material(row)


def delete_project_material(
    user_id: str,
    project_id: str,
    material_id: str,
) -> list[str]:
    _schema_initializer()
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        access = project_material_access(conn, user_id, project_id)
        material = conn.execute(
            "SELECT created_by_user_id, object_key, node_type, parent_id "
            "FROM project_materials "
            "WHERE id = ? AND project_id = ? "
            "AND (node_type = 'file' OR "
            "(node_type = 'collection' AND parent_id = ''))",
            (material_id, project_id),
        ).fetchone()
        if material is None:
            raise LookupError("Project material not found")
        if material["created_by_user_id"] != user_id and access["role"] not in {
            "owner", "admin",
        }:
            raise ProjectPermissionDenied(
                "Only the material creator and project managers can delete materials",
            )
        if material["node_type"] == "collection":
            child_rows = conn.execute(
                "SELECT object_key FROM project_materials "
                "WHERE project_id = ? AND parent_id = ? AND node_type = 'file'",
                (project_id, material_id),
            ).fetchall()
            conn.execute(
                "DELETE FROM project_materials "
                "WHERE project_id = ? AND parent_id = ? AND node_type = 'file'",
                (project_id, material_id),
            )
            conn.execute(
                "DELETE FROM project_materials WHERE id = ?",
                (material_id,),
            )
            return [row["object_key"] for row in child_rows if row["object_key"]]
        conn.execute(
            "DELETE FROM project_materials WHERE id = ?",
            (material_id,),
        )
        return [material["object_key"]] if material["object_key"] else []
