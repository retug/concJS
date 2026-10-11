from django.urls import path

from . import views


app_name = "concrete_verification"

urlpatterns = [
    path("", views.index, name="index"),
    path("<slug:case_id>/", views.problem, name="problem"),
]
