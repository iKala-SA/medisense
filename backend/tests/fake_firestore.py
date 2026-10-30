"""Minimal in-memory stand-in for google.cloud.firestore.Client, enough for this backend's queries."""
import copy
import itertools

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore

_ids = itertools.count(1)


def _get(d: dict, path: str):
    cur = d
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


class Snap:
    def __init__(self, ref: "DocRef", data: dict | None):
        self.reference, self.id, self._d = ref, ref.id, data

    @property
    def exists(self) -> bool:
        return self._d is not None

    def to_dict(self):
        return copy.deepcopy(self._d) if self._d is not None else None


class DocRef:
    def __init__(self, client: "FakeClient", path: str):
        self.client, self.path, self.id = client, path, path.rsplit("/", 1)[-1]

    def get(self):
        return Snap(self, self.client.store.get(self.path))

    def set(self, data: dict, merge: bool = False):
        cur = self.client.store.get(self.path) or {}
        self.client.store[self.path] = {**cur, **copy.deepcopy(data)} if merge else copy.deepcopy(data)

    def create(self, data: dict):
        if self.path in self.client.store:
            raise AlreadyExists("exists")
        self.set(data)

    def update(self, data: dict):
        if self.path not in self.client.store:
            raise KeyError(self.path)
        cur = self.client.store[self.path]
        for k, v in copy.deepcopy(data).items():
            if isinstance(v, firestore.ArrayUnion):
                cur[k] = list(cur.get(k) or []) + [x for x in v.values if x not in (cur.get(k) or [])]
            elif isinstance(v, firestore.ArrayRemove):
                cur[k] = [x for x in (cur.get(k) or []) if x not in v.values]
            else:
                cur[k] = v

    def delete(self):
        self.client.store.pop(self.path, None)

    def collection(self, name: str):
        return Query(self.client, f"{self.path}/{name}")


class Query:
    def __init__(self, client, coll: str, filters=(), order=None, lim=None):
        self.client, self.coll, self.filters, self.order, self.lim = client, coll, tuple(filters), order, lim

    def _clone(self, **kw):
        a = dict(filters=self.filters, order=self.order, lim=self.lim)
        a.update(kw)
        return Query(self.client, self.coll, **a)

    # collection API
    def document(self, doc_id: str | None = None):
        return DocRef(self.client, f"{self.coll}/{doc_id or 'auto%d' % next(_ids)}")

    def add(self, data: dict):
        ref = self.document()
        ref.set(data)
        return None, ref

    # query API
    def where(self, *a, filter=None):
        cond = (filter.field_path, filter.op_string, filter.value) if filter is not None else tuple(a)
        return self._clone(filters=(*self.filters, cond))

    def order_by(self, field, direction=None):
        return self._clone(order=(field, direction == "DESCENDING"))

    def limit(self, n):
        return self._clone(lim=n)

    def select(self, _fields):
        return self

    def stream(self):
        depth = self.coll.count("/") + 1
        rows = []
        for path, data in self.client.store.items():
            if path.startswith(self.coll + "/") and path.count("/") == depth and self._match(data):
                rows.append(Snap(DocRef(self.client, path), data))
        if self.order:
            f, desc = self.order
            rows = sorted(rows, key=lambda s: _get(s._d, f) or 0, reverse=desc)
        return iter(rows[: self.lim] if self.lim else rows)

    def _match(self, d: dict) -> bool:
        for field, op, val in self.filters:
            v = _get(d, field)
            ok = {
                "==": lambda: v == val, "!=": lambda: v != val,
                "<": lambda: v is not None and v < val, "<=": lambda: v is not None and v <= val,
                ">": lambda: v is not None and v > val, ">=": lambda: v is not None and v >= val,
                "array_contains": lambda: isinstance(v, list) and val in v,
                "array_contains_any": lambda: isinstance(v, list) and any(x in v for x in val),
                "in": lambda: v in val,
            }[op]()
            if not ok:
                return False
        return True


class FakeClient:
    def __init__(self):
        self.store: dict[str, dict] = {}

    def collection(self, name: str):
        return Query(self, name)

    def get_all(self, refs):
        return [r.get() for r in refs]

    # helpers for tests
    def put(self, path: str, data: dict):
        self.store[path] = copy.deepcopy(data)
