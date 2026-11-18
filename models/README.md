# Vision checkpoints

- `pretrain.pt` is the CIVIC debris checkpoint, fine-tuned from Ultralytics YOLO11n on [TACO](https://tacodataset.org/). Training utilities are in `tools/get_taco.py`, `tools/resize_dataset.py`, and `tools/train.py`.
- `../yolo11n.pt` is the Ultralytics YOLO11n general object checkpoint. Its model and implementation source are provided by [Ultralytics](https://github.com/ultralytics/ultralytics).

The YOLO checkpoints are provided under [AGPL-3.0](LICENSE). See the [upstream YOLO11 model documentation](https://docs.ultralytics.com/models/yolo11/) for attribution and model details.
