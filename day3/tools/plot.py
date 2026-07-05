#!/usr/bin/env python3
"""
IMmerseU — quick-look plots for collected gesture reps.

Usage:
    python plot.py data/jab.csv data/hook.csv data/uppercut.csv data/block.csv

Shows per-gesture time-series overlays (accel + gyro) plus a peak-magnitude bar
so you can eyeball reasonable thresholds before writing the classifier.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

CHANNELS = ["ax", "ay", "az", "gx", "gy", "gz"]

def load(path):
    df = pd.read_csv(path)
    if "label" not in df.columns:
        sys.exit(f"{path}: missing 'label' column")
    return df

def plot_gesture(df, ax_accel, ax_gyro):
    label = df["label"].iloc[0]
    for rep, sub in df.groupby("rep"):
        t = np.arange(len(sub)) / 200.0  # 200 Hz assumed
        for ch, style in zip(["ax","ay","az"], ["-", "--", ":"]):
            ax_accel.plot(t, sub[ch], style, alpha=0.4)
        for ch, style in zip(["gx","gy","gz"], ["-", "--", ":"]):
            ax_gyro.plot(t, sub[ch], style, alpha=0.4)
    ax_accel.set_title(f"{label} — accel (m/s²)")
    ax_gyro.set_title(f"{label} — gyro (deg/s)")
    ax_accel.grid(True, alpha=0.3)
    ax_gyro.grid(True, alpha=0.3)

def peak_summary(dfs):
    rows = []
    for df in dfs:
        label = df["label"].iloc[0]
        for rep, sub in df.groupby("rep"):
            row = {"label": label, "rep": rep}
            for ch in CHANNELS:
                row[f"peak_{ch}"] = sub[ch].abs().max()
            row["peak_accel_mag"] = np.sqrt(sub["ax"]**2 + sub["ay"]**2 + sub["az"]**2).max()
            row["peak_gyro_mag"]  = np.sqrt(sub["gx"]**2 + sub["gy"]**2 + sub["gz"]**2).max()
            rows.append(row)
    return pd.DataFrame(rows)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", help="CSVs from collect.py")
    args = ap.parse_args()

    dfs = [load(Path(p)) for p in args.files]

    fig, axes = plt.subplots(len(dfs), 2, figsize=(12, 3*len(dfs)), squeeze=False)
    for i, df in enumerate(dfs):
        plot_gesture(df, axes[i][0], axes[i][1])
    fig.tight_layout()

    summary = peak_summary(dfs)
    print("\nPer-rep peaks:")
    print(summary.to_string(index=False))
    print("\nBy label (median / p90):")
    grp = summary.groupby("label")[["peak_accel_mag", "peak_gyro_mag"]]
    print(grp.agg(["median", lambda x: np.percentile(x, 90)]).to_string())

    fig2, ax = plt.subplots(1, 2, figsize=(10, 4))
    summary.boxplot(column="peak_accel_mag", by="label", ax=ax[0])
    summary.boxplot(column="peak_gyro_mag",  by="label", ax=ax[1])
    ax[0].set_title("peak |accel| by gesture")
    ax[1].set_title("peak |gyro| by gesture")
    plt.suptitle("")
    fig2.tight_layout()

    plt.show()

if __name__ == "__main__":
    main()
