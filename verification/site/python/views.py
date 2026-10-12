"""Read the versioned catalog; never accept a user-supplied model file path."""

import json
from pathlib import Path
import re

from django.core.exceptions import ImproperlyConfigured
from django.http import Http404
from django.shortcuts import render


CATALOG_PATH = Path(__file__).with_name("catalog.json")
CASE_ID_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
MODEL_FILE_PATTERN = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._-]*\.json")


def _load_cases():
    try:
        catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ImproperlyConfigured("The concrete verification catalog could not be read.") from error

    if not isinstance(catalog, dict) or catalog.get("schemaVersion") != 1:
        raise ImproperlyConfigured("Unsupported concrete verification catalog version.")
    cases = catalog.get("cases")
    if not isinstance(cases, list):
        raise ImproperlyConfigured("The concrete verification catalog must contain a cases list.")

    seen_ids = set()
    prepared = []
    for entry in cases:
        if not isinstance(entry, dict):
            raise ImproperlyConfigured("Each concrete verification case must be an object.")
        case_id = entry.get("id", "")
        if not isinstance(case_id, str) or not CASE_ID_PATTERN.fullmatch(case_id) or case_id in seen_ids:
            raise ImproperlyConfigured("Concrete verification case IDs must be unique URL slugs.")
        seen_ids.add(case_id)

        case = dict(entry)
        model_file = case.get("modelFile")
        if model_file:
            if not isinstance(model_file, str) or not MODEL_FILE_PATTERN.fullmatch(model_file):
                raise ImproperlyConfigured("A verification modelFile must be a JSON filename.")
            case["model_static_path"] = "concgui/verification/models/" + model_file
        preview_file = case.get("previewFile")
        if preview_file:
            if not isinstance(preview_file, str) or not re.fullmatch(r"[a-z0-9-]+\.png", preview_file):
                raise ImproperlyConfigured("A verification preview must be a PNG filename.")
            case["preview_static_path"] = "concgui/verification/" + preview_file
        if case.get("status") == "comparison-ready":
            case["comparison_static_path"] = "concgui/verification/results/" + case_id + ".json"
            case["chart_static_path"] = "concgui/verification/results/" + case_id + ".svg"
        prepared.append(case)
    return prepared


def index(request):
    return render(request, "blog/verification/index.html", {
        "title": "Concrete Design Verification | Re-Tug",
        "cases": _load_cases(),
    })


def problem(request, case_id):
    case = next((entry for entry in _load_cases() if entry["id"] == case_id), None)
    if case is None:
        raise Http404("Verification problem not found.")
    comparison = None
    if case.get("status") == "comparison-ready":
        try:
            comparison = json.loads((CATALOG_PATH.parent / "results" / (case_id + ".json")).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise ImproperlyConfigured("The concrete verification comparison could not be read.") from error
        # Formatting stays separate from the unrounded downloadable calculations.
        for row in comparison["rows"]:
            for group in ("published", "computed", "difference", "delta", "ratio"):
                if group not in row:
                    continue
                row[group + "_display"] = {
                    key: "—" if value is None else format(0 if abs(value) < 0.05 else value, ",.1f")
                    for key, value in row[group].items()
                }
            if comparison.get("kind") == "fixed-mm":
                row["ratio_display"] = {
                    key: "—" if value is None else format(value * 100, ",.1f") + "%"
                    for key, value in row.get("ratio", {}).items()
                }
    return render(request, "blog/verification/problem.html", {
        "title": "{} | Concrete Design Verification | Re-Tug".format(case["title"]),
        "case": case,
        "comparison": comparison,
    })
